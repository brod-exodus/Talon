# GitHub Scraper

A modern GitHub contributor intelligence tool that scrapes repositories and organizations to extract contributors with contact information only.

## Features

- Scrape GitHub organizations or individual repositories
- Extract contributor details including email, Twitter/X, LinkedIn, and websites
- Real-time progress tracking
- 5,000 requests/hour rate limit with authenticated GitHub API
- Modern, sleek UI with dark theme

## Setup

1. **Install dependencies:**
   \`\`\`bash
   npm install
   \`\`\`

2. **Create a GitHub Personal Access Token:**
   - Go to https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Select scopes: `public_repo`, `read:org`, `read:user`
   - Copy the token

3. **Add environment variables:**
   - Copy `.env.example` to `.env.local`
   - Add your GitHub token:
     \`\`\`
     GITHUB_TOKEN=your_github_token_here
     \`\`\`

4. **Run the development server:**
   \`\`\`bash
   npm run dev
   \`\`\`

5. **Open http://localhost:3000**

## Usage

1. Select scrape type (Organization or Repository)
2. Enter the target (e.g., "vercel" or "vercel/next.js")
3. Click "Start Scrape"
4. Monitor real-time progress
5. View contributor results with contact information

## Rate Limits

- **Unauthenticated:** 60 requests/hour
- **Authenticated:** 5,000 requests/hour

With a GitHub token, you get 5,000 requests per hour, allowing you to scrape large organizations efficiently.

## Tech Stack

- Next.js 15
- TypeScript
- Tailwind CSS
- shadcn/ui
- GitHub REST API
