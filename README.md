This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Configuration

This application uses environment variables for configuration. Create a `.env` file in the project root and add the following variables:

```dotenv
# Required for Browserbase integration (if used)
BROWSERBASE_API_KEY=your_browserbase_api_key
BROWSERBASE_PROJECT_ID=your_browserbase_project_id

# Required for OpenAI Embeddings
OPENAI_API_KEY=your_openai_api_key

# Required for Chroma Vector Store
# Typically http://localhost:8000 if running locally via Docker
CHROMA_URL=http://localhost:8000

# Optional: API Key for Chroma Cloud (if applicable)
# CHROMA_API_KEY=your_chroma_cloud_api_key

# Optional: URL for the Next.js development server (defaults to http://localhost:3000)
# NEXT_DEV_SERVER_URL=http://localhost:3000

# Optional: Set to true to open DevTools on startup (defaults to true in dev)
# OPEN_DEVTOOLS=true
```

Make sure this `.env` file is not committed to version control (it should be listed in your `.gitignore`).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
