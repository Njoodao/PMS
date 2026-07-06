// KABi Jira CORS Proxy — Lightweight serverless function
// This does NOT use Vercel Blob, KV, Edge Config, or any storage product.
// It simply forwards the Jira API request to bypass CORS restrictions.
// Vercel Serverless Functions free tier: 100 GB-hrs/month (more than enough).

export default async function handler(req, res) {
  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { system, domain, email, token } = req.body || {};

  if (system === 'jira') {
    if (!domain || !token) {
      return res.status(400).json({ error: 'Missing domain or token' });
    }

    const auth = Buffer.from(`${email || 'admin@kabi.ai'}:${token}`).toString('base64');
    const url = `https://${domain}/rest/api/3/search?maxResults=100&fields=summary,status,issuetype,assignee,created,updated,resolutiondate,project,priority`;

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({ 
          error: `Jira API ${response.status}: ${text.slice(0, 200)}` 
        });
      }

      const data = await response.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(502).json({ error: `Proxy error: ${err.message}` });
    }
  }

  return res.status(400).json({ error: `Unknown system: ${system}` });
}
