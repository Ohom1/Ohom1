const fs = require('fs');
const https = require('https');

const USERNAME = process.env.GITHUB_USERNAME || 'Ohom1';
const TOKEN = process.env.GITHUB_TOKEN;
const OUTPUT = process.env.OUTPUT || 'profile/streak.svg';

if (!TOKEN) {
  throw new Error('GITHUB_TOKEN is required');
}

function graphql(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Ohom1-profile-stats',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.errors) return reject(new Error(JSON.stringify(json.errors)));
          resolve(json.data);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-IN').format(value);
}

function createSvg(current, longest, total) {
  const width = 495;
  const height = 195;
  const title = 'GitHub Streak';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="GitHub contribution streak statistics for ${escapeXml(USERNAME)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#161b22"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" rx="10" fill="url(#bg)" stroke="#30363d"/>
  <text x="24" y="38" fill="#e6edf3" font-family="Segoe UI,Arial,sans-serif" font-size="21" font-weight="700">${title}</text>
  <text x="24" y="60" fill="#8b949e" font-family="Segoe UI,Arial,sans-serif" font-size="12">@${escapeXml(USERNAME)} • updated by GitHub Actions</text>

  <line x1="24" y1="78" x2="471" y2="78" stroke="#30363d"/>

  <text x="24" y="104" fill="#8b949e" font-family="Segoe UI,Arial,sans-serif" font-size="12">Current streak</text>
  <text x="24" y="132" fill="#36BCF7" font-family="Segoe UI,Arial,sans-serif" font-size="25" font-weight="700">${formatNumber(current)} days</text>

  <text x="183" y="104" fill="#8b949e" font-family="Segoe UI,Arial,sans-serif" font-size="12">Longest streak</text>
  <text x="183" y="132" fill="#36BCF7" font-family="Segoe UI,Arial,sans-serif" font-size="25" font-weight="700">${formatNumber(longest)} days</text>

  <text x="342" y="104" fill="#8b949e" font-family="Segoe UI,Arial,sans-serif" font-size="12">Contributions</text>
  <text x="342" y="132" fill="#36BCF7" font-family="Segoe UI,Arial,sans-serif" font-size="25" font-weight="700">${formatNumber(total)}</text>

  <text x="24" y="166" fill="#8b949e" font-family="Segoe UI,Arial,sans-serif" font-size="11">Based on GitHub contribution calendar • public contribution data</text>
</svg>`;
}

async function main() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const data = await graphql(query, { login: USERNAME });
  const calendar = data.user.contributionsCollection.contributionCalendar;
  const days = calendar.weeks.flatMap(week => week.contributionDays)
    .sort((a, b) => a.date.localeCompare(b.date));

  let longest = 0;
  let run = 0;
  for (const day of days) {
    if (day.contributionCount > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  // A streak is considered active through today. If today has no contribution,
  // allow yesterday to be the final day of an active streak.
  let current = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i].contributionCount > 0) {
      current += 1;
    } else {
      break;
    }
  }

  if (current === 0 && days.length > 1) {
    const last = days[days.length - 1];
    const previous = days[days.length - 2];
    if (last.contributionCount === 0 && previous.contributionCount > 0) {
      for (let i = days.length - 2; i >= 0; i -= 1) {
        if (days[i].contributionCount > 0) current += 1;
        else break;
      }
    }
  }

  fs.mkdirSync(require('path').dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, createSvg(current, longest, calendar.totalContributions));
  console.log(`Generated ${OUTPUT}: current=${current}, longest=${longest}, total=${calendar.totalContributions}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
