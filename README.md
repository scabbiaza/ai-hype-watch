# 🕵️‍♂️ AI Hype-Watch: Skeptical Investigator

> **Note**: This is an **exploration project** designed to experiment with LLM-based automated analysis, bias detection, and agentic workflows.

## ❓ Why
The current AI news cycle is flooded with corporate press releases, hype, and hidden sales pitches. It is increasingly difficult to distinguish between genuine technological advancements and marketing fluff designed to boost stock prices or sell services. This tool automates the "skepticism" required to analyze these trends efficiently.

## 💡 What
This is a lightweight **Agentic Workflow** (or sequential pipeline) that acts as a skeptical business investigator. It performs the following workflow:

1.  **The Scout**: Fetches the latest articles about "AI business use cases" via NewsAPI.
2.  **The Gatekeeper**: Filters the fetched articles to ensure they are genuinely about business strategies or market trends, discarding generic fluff.
3.  **The Investigator**: Uses an LLM (OpenAI compatible) to analyze each article with a specific "skeptical" persona. It determines:
    *   **Summary**: A concise summary of the article.
    *   **Seller Identity**: What the organization actually sells.
    *   **Hidden Motive**: Analysis of whether the article promotes a specific business agenda.
    *   **Motive Score**: A 1-10 score indicating the intensity of the sales pitch.
    *   **Critique**: A skeptical critique of the content.
4.  **The Reporter**: Generates a clean, styled HTML dashboard summarizing the findings with risk indicators.

## 🚀 How to Use

### Prerequisites
*   Node.js installed.
*   API Key from NewsAPI.
*   Access to an LLM (OpenAI API Key or a local model like LM Studio/Ollama compatible with the OpenAI SDK).

### Setup

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Environment Variables**
    Create a `.env` file in the root directory with the following keys:

    ```env
    # LLM Configuration (OpenAI or Local)
    LLM_API_KEY=your_llm_api_key
    LLM_BASE_URL=https://api.openai.com/v1  # or http://localhost:1234/v1 for local
    LLM_MODEL=gpt-4o  # or your local model name

    # News Data Source
    NEWS_API_KEY=your_newsapi_key

    # Tuning
    NEWS_MAX_REQUESTS=5
    NEWS_BATCH_SIZE=20  # Articles to fetch per API call (before filtering)
    RESPECT_RPM=4500  # Delay between calls in ms to avoid rate limits
    ```

3.  **Run the Investigator**
    ```bash
    npx ts-node src/index.ts
    ```

4.  **View Report**
    Once the script finishes, open the generated `report_YYYY-MM-DD.html` file in your browser to view the analysis.

## 📊 Sample Output
Want to see what the report looks like? Check out the [Sample HTML Report](examples/sample_report.html) in the `examples/` folder.

## 📋 Example Execution

```bash
npx ts-node src/index.ts
```

```text
🕵️‍♂️ Starting Investigation...
🔄 Cache only has 10/25 articles. Re-fetching...
🌐 Fetching articles from NewsAPI to find 25 relevant business cases...

📄 Fetching Page 1...
   ❌ [Skipped] The surprising case for AI judges
   ❌ [Skipped] For Some Reason, Someone Who Generates AI Slop Books Has Unmasked Herself
   ✅ [Relevant] Amazon CEO says the pet-finder AI tool on Ring Doorbells helped bring home 99 dogs home in 90 days
   ✅ [Relevant] Where banks should focus AI spending to stay ahead, from Wall Street's AI scorekeeper
   ❌ [Skipped] Section 230 turns 30 as it faces its biggest tests yet

📄 Fetching Page 2...
   ✅ [Relevant] Siemens CEO Roland Busch’s mission to automate everything
   ✅ [Relevant] The three ways AI might get you laid off work
   ✅ [Relevant] Tech bull Dan Ives says Wall Street's software skepticism is 'the most disconnected call that I've ever seen'
   ✅ [Relevant] Nvidia Deepens AI Inference Push With Groq Deal And Rubin Platform
   ❌ [Skipped] I Have 11 Home Security Myths You Need to Memory Wipe

📄 Fetching Page 3...
   ❌ [Skipped] AI companions are reshaping teen emotional bonds
   ✅ [Relevant] AI spurs employees to work harder, faster, and with fewer breaks, study finds
   ✅ [Relevant] Google Clarifies Its Stance On Campaign Consolidation via @sejournal, @brookeosmundson
   ✅ [Relevant] Synthetic Personas For Better Prompt Tracking via @sejournal, @Kevin_Indig
   ❌ [Skipped] Tech I’m Obsessed With

[1/9] Investigating: Amazon CEO says the pet-finder AI tool on Ring Doorbells helped bring home 99 dogs home in 90 days...
✨ Using cached analysis for: Amazon CEO says the pet-finder AI tool on Ring Doorbells helped bring home 99 dogs home in 90 days...

[2/9] Investigating: Where banks should focus AI spending to stay ahead, from Wall Street's AI scorekeeper...
✨ Using cached analysis for: Where banks should focus AI spending to stay ahead, from Wall Street's AI scorekeeper...

[3/9] Investigating: Siemens CEO Roland Busch’s mission to automate everything...
🤖 Requesting LLM analysis for: Siemens CEO Roland Busch’s mission to automate everything...
⏱ Waiting 4500ms to respect API limits...

...

[9/9] Investigating: Synthetic Personas For Better Prompt Tracking via @sejournal, @Kevin_Indig...
🤖 Requesting LLM analysis for: Synthetic Personas For Better Prompt Tracking via @sejournal, @Kevin_Indig...

✅ HTML Dashboard generated: /reports/report_2026-02-14.html
```

## 🛠️ Tech Stack
*   **Runtime**: Node.js & TypeScript
*   **Data**: NewsAPI
*   **Analysis**: OpenAI API (compatible with Local LLMs)
*   **Utilities**: Axios, Marked, Dotenv

## Tags
`TypeScript` `Node.js` `OpenAI API` `GPT-4` `Llama 3` `Mistral` `NewsAPI` `Axios` `Marked` `Dotenv` `Agentic Workflow` `Bias Detection` `Automation`
