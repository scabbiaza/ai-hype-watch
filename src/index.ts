import OpenAI from 'openai';
import axios from 'axios';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as crypto from 'node:crypto';
import { marked } from 'marked';

// 1. Validate Environment Variables
const requiredEnv = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'NEWS_API_KEY'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const CONFIG = {
  llmApiKey: process.env.LLM_API_KEY!,
  llmBaseUrl: process.env.LLM_BASE_URL!,
  llmModel: process.env.LLM_MODEL!,
  newsApiKey: process.env.NEWS_API_KEY!,
  newsMaxRequests: parseInt(process.env.NEWS_MAX_REQUESTS || "5"),
  newsBatchSize: parseInt(process.env.NEWS_BATCH_SIZE || "20"),
  respectRPM: parseInt(process.env.RESPECT_RPM || "4500"),
};

// Unified OpenAI-compatible client
const client = new OpenAI({
  apiKey: CONFIG.llmApiKey,
  baseURL: CONFIG.llmBaseUrl,
});

const CACHE_DIR = path.join(process.cwd(), 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

// Configure marked to handle line breaks and GFM correctly
marked.use({
  breaks: true,
  gfm: true
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 3. Define Interface for Type Safety
interface NewsArticle {
  title: string;
  url: string;
  source: string;
  description: string;
}

/**
 * AGENT 1.5: THE GATEKEEPER (Relevance Filter)
 * Checks if the article is actually about a business case before we do deep analysis.
 */
async function validateRelevance(article: NewsArticle): Promise<boolean> {
  try {
    const completion = await client.chat.completions.create({
      model: CONFIG.llmModel,
      messages: [
        { role: "system", content: "You are a strict news editor. Output JSON." },
        { role: "user", content: `
          Analyze if this article is explicitly about a specific business use case, corporate strategy, market trend, or financial implication of AI.
          Discard generic "AI is the future" fluff, pure research papers, or simple product announcements without business context.

          Title: "${article.title}"
          Description: "${article.description}"
          
          Return JSON: { "is_business_case": boolean }
        `}
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const result = JSON.parse(completion.choices[0].message.content || "{}");
    return result.is_business_case === true;
  } catch (e) {
    console.error(`   ⚠️ Gatekeeper error for "${article.title}":`, e);
    return false; // Fail safe: skip if we can't validate
  }
}

/**
 * AGENT 1: THE SCOUT (NewsAPI)
 */
async function fetchNews(topic: string): Promise<NewsArticle[]> {
  const cachePath = path.join(CACHE_DIR, `${topic.replace(/\s+/g, '_')}.json`);
  const CACHE_TTL = 24 * 60 * 60 * 1000;

  // 1. Try to load from Cache
  if (fs.existsSync(cachePath)) {
    const stats = fs.statSync(cachePath);
    const isFresh = (Date.now() - stats.mtimeMs) < CACHE_TTL;

    if (isFresh) {
      const cachedData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));

      // CRITICAL FIX: Only use cache if it has AT LEAST the number of articles requested
      // If CONFIG.maxArticles is 10 but cache only has 5, we must re-fetch.
      if (cachedData.length >= CONFIG.newsMaxRequests) {
        console.log(`📦 Loading ${CONFIG.newsMaxRequests} articles from local cache...`);
        return cachedData.slice(0, CONFIG.newsMaxRequests);
      } else {
        console.log(`🔄 Cache only has ${cachedData.length}/${CONFIG.newsMaxRequests} articles. Re-fetching...`);
      }
    }
  }

  // 2. Fetch from API if cache is missing, old, or too small
  console.log(`🌐 Fetching articles from NewsAPI to find ${CONFIG.newsMaxRequests} relevant business cases...`);
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  const fromDate = lastWeek.toISOString().split('T')[0];

  let page = 1;
  const MAX_PAGES = 3; // Limit re-requests to avoid infinite loops
  const collectedArticles: NewsArticle[] = [];
  const seenUrls = new Set<string>();

  while (collectedArticles.length < CONFIG.newsMaxRequests && page <= MAX_PAGES) {
    console.log(`\n📄 Fetching Page ${page}...`);

    try {
      const response = await axios.get('https://newsapi.org/v2/everything', {
        params: {
          q: topic,
          from: fromDate,
          pageSize: CONFIG.newsBatchSize, // Fetch a batch to filter through
          sortBy: 'relevancy',
          language: 'en',
          page: page
        },
        headers: { 'X-Api-Key': CONFIG.newsApiKey }
      });

      if (!response.data.articles || response.data.articles.length === 0) {
        console.log("   ⚠️ No more articles available.");
        break;
      }

      for (const a of response.data.articles) {
        if (collectedArticles.length >= CONFIG.newsMaxRequests) break;
        if (seenUrls.has(a.url)) continue;
        seenUrls.add(a.url);

        const article: NewsArticle = {
          title: a.title,
          url: a.url,
          source: a.source.name,
          description: a.description || ""
        };

        // Check relevance with Agent 1.5
        const isRelevant = await validateRelevance(article);
        if (isRelevant) {
          console.log(`   ✅ [Relevant] ${article.title}`);
          collectedArticles.push(article);
        } else {
          console.log(`   ❌ [Skipped] ${article.title}`);
        }
      }
      page++;
    } catch (error: any) {
      console.error(`   ❌ Error fetching page ${page}:`, error.message);
      break;
    }
  }

  if (collectedArticles.length === 0) {
    throw new Error("NewsAPI returned no relevant articles after filtering.");
  }

  // 3. Update Cache
  fs.writeFileSync(cachePath, JSON.stringify(collectedArticles, null, 2));

  return collectedArticles;
}

// 4. Define Interface for Structured Analysis
interface MotiveAnalysis {
  summary: string;
  seller_description: string;
  hidden_motive: string;
  motive_score: number;
  critique: string;
}

/**
 * AGENT 2: THE INVESTIGATOR & CRITIC (with Analysis Cache)
 */
async function analyzeMotive(article: NewsArticle): Promise<{ analysis: MotiveAnalysis, fromCache: boolean }> {
  const systemPrompt = "You are a skeptical business investigator. Your job is to uncover corporate bias in news articles. You must respond in valid JSON.";
  const userPrompt = `
          INVESTIGATION TASK:
          Article Title: "${article.title}"
          Source: "${article.source}"
          Description: "${article.description}"
          URL: ${article.url}

          Analyze the article and return a JSON object with the following fields:
          - "summary": A concise 2-sentence summary.
          - "seller_description": What this organization actually sells based on source/description.
          - "hidden_motive": Analysis of whether this promotes a business case for the source.
          - "motive_score": An integer from 1-10 (10 = pure sales pitch).
          - "critique": A 3-sentence skeptical critique.
        `;

  // 1. Create a unique ID for the article to use as a cache key
  // 6. Cache Invalidation: Include prompt hash in key so changing prompts invalidates cache
  const promptHash = crypto.createHash('md5').update(systemPrompt + userPrompt).digest('hex');
  const articleHash = crypto.createHash('md5').update((article.url || article.title) + promptHash).digest('hex');

  const cachePath = path.join(CACHE_DIR, `analysis_${articleHash}.json`);

  // 2. Check if this analysis already exists in the cache
  if (fs.existsSync(cachePath)) {
    console.log(`✨ Using cached analysis for: ${article.title}`);
    const cachedResult = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    return { analysis: cachedResult.analysis, fromCache: true };
  }

  // 3. If not cached, proceed to the LLM call
  console.log(`🤖 Requesting LLM analysis for: ${article.title}...`);

  const completion = await client.chat.completions.create({
    model: CONFIG.llmModel,
    messages: [
      {
        role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.3,
    response_format: { type: "json_object" } // ENABLE JSON MODE
  });

  let analysisResult: MotiveAnalysis;
  try {
    analysisResult = JSON.parse(completion.choices[0].message.content || "{}") as MotiveAnalysis;
  } catch (error) {
    throw new Error("Failed to parse LLM JSON response: " + (error as Error).message);
  }

  // 4. Save the result to cache before returning
  fs.writeFileSync(cachePath, JSON.stringify({
    title: article.title,
    url: article.url,
    analysis: analysisResult,
    timestamp: new Date().toISOString()
  }, null, 2));

  return { analysis: analysisResult, fromCache: false };
}

// Define the structure for our results
interface AnalysisResult {
  title: string;
  url: string;
  source: string;
  analysis: MotiveAnalysis; // Structured data
}

// 5. Basic HTML Sanitization
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
    .replace(/on\w+="[^"]*"/g, "")
    .replace(/javascript:/gi, "");
}

/**
 * GENERATOR: Creates a clean HTML dashboard
 */
function generateHTMLReport(results: AnalysisResult[]) {
  const today = new Date();
  const lastWeek = new Date();
  lastWeek.setDate(today.getDate() - 7);

  const dateTo = today.toLocaleDateString('en-CA');
  const dateFrom = lastWeek.toLocaleDateString('en-CA');
  const periodString = `${dateFrom} to ${dateTo}`;

  const REPORTS_DIR = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR);

  const htmlFileName = `report_${dateTo}.html`;
  const htmlPath = path.join(REPORTS_DIR, htmlFileName);

  const css = `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; padding: 20px; background-color: #f4f7f6; }
      .header { text-align: center; margin-bottom: 30px; }
      .period-badge { background: #34495e; color: white; padding: 5px 15px; border-radius: 20px; font-size: 0.9em; }
      table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }
      th, td { padding: 15px; text-align: left; border-bottom: 1px solid #eee; vertical-align: top; }
      th { background-color: #3498db; color: white; text-transform: uppercase; font-size: 13px; }
      
      /* Style the parsed Markdown content */
      .analysis-content h1, .analysis-content h2 { font-size: 1.1em; margin-top: 0; }
      .analysis-content p { margin: 0 0 10px 0; }
      .analysis-content ul { padding-left: 20px; margin: 0; }
      .analysis-content strong { color: #2c3e50; }
      
      .score-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-weight: bold; color: white; min-width: 40px; text-align: center; }
      .high-risk { background-color: #e74c3c; }
      .med-risk { background-color: #f39c12; }
      .low-risk { background-color: #27ae60; }
      a { color: #3498db; text-decoration: none; }
    </style>
  `;

  const rows = results.map(res => {
    const { summary, seller_description, hidden_motive, motive_score, critique } = res.analysis;

    const score = motive_score ?? 0;

    let scoreClass = 'low-risk';
    if (score >= 8) scoreClass = 'high-risk';
    else if (score >= 4) scoreClass = 'med-risk';

    // Construct HTML from structured fields (using marked for inner markdown support)
    const formattedAnalysis = `
      <p><strong>Summary:</strong> ${sanitizeHtml(marked.parse(summary) as string)}</p>
      <p><strong>Seller Identity:</strong> ${sanitizeHtml(marked.parse(seller_description) as string)}</p>
      <p><strong>Hidden Motive:</strong> ${sanitizeHtml(marked.parse(hidden_motive) as string)}</p>
      <p><strong>Critique:</strong> <em>${sanitizeHtml(marked.parse(critique) as string)}</em></p>
    `;

    return `
      <tr>
        <td>
          <strong>${res.title}</strong><br>
          <small>Source: ${res.source}</small><br>
          <small><a href="${res.url}" target="_blank">Read Article &rarr;</a></small>
        </td>
        <td class="analysis-content">${formattedAnalysis}</td>
        <td><span class="score-badge ${scoreClass}">${motive_score !== undefined && motive_score !== null ? motive_score : 'N/A'}</span></td>
      </tr>
    `;
  }).join('');

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AI Hype-Watch: ${periodString}</title>
        ${css}
    </head>
    <body>
        <div class="header">
            <h1>🕵️‍♂️ AI Hype-Watch: Skeptical Investigator Report</h1>
            <span class="period-badge">Period: ${periodString}</span>
        </div>
        <table>
            <thead>
                <tr>
                    <th style="width: 25%">Article & Source</th>
                    <th style="width: 65%">Investigation Findings</th>
                    <th style="width: 10%">Bias Score</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    </body>
    </html>
  `;

  fs.writeFileSync(htmlPath, htmlContent);
  console.log(`\n✅ HTML Dashboard generated: ${htmlPath}`);
}

/**
 * ORCHESTRATOR
 */
async function runMAS() {
  console.log("🕵️‍♂️ AI Hype-Watch: Starting Investigation...");
  const finalResults: AnalysisResult[] = [];

  try {
    const articles = await fetchNews("AI business use cases");

    for (const [index, article] of articles.entries()) {
      console.log(`\n[${index + 1}/${articles.length}] Investigating: ${article.title}...`);

      // 1. Error Handling: Fail-fast loop fix
      try {
        const { analysis, fromCache } = await analyzeMotive(article);

        finalResults.push({
          title: article.title,
          url: article.url,
          source: article.source,
          analysis: analysis
        });

        // Only wait if we hit the API (not from cache)
        if (!fromCache && index < articles.length - 1) {
          console.log(`⏱ Waiting ${CONFIG.respectRPM}ms to respect API limits...`);
          await sleep(CONFIG.respectRPM);
        }
      } catch (err: any) {
        console.error(`⚠️ Failed to analyze article "${article.title}":`, err.message);
        // Continue to next article instead of crashing
      }
    }
    // After the loop finishes, generate the HTML
    generateHTMLReport(finalResults);

  } catch (error: any) {
    console.error("\n🛑 Stopped: ", error.message);
    // Even if it stops, let's try to generate a report with what we have
    if (finalResults.length > 0) generateHTMLReport(finalResults);
    process.exit(1);
  }
}

runMAS();
