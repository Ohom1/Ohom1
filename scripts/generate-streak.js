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

  <text x="342" y="104" fill="#8b949e" font-family="Segoe UI,Arial,sans-serif" font-size="12">Total Contributions</text>
  <text x="342" y="132" fill="#36BCF7" font-family="Segoe UI,Arial,sans-serif" font-size="25" font-weight="700">${formatNumber(total)}</text>

  <text x="24" y="166" fill="#8b949e" font-family="Segoe UI,Arial,sans-serif" font-size="11">Lifetime GitHub contributions • public contribution data</text>
</svg>`;
}

async function main() {
  const metaQuery = `
    query($login: String!) {
      user(login: $login) {
        createdAt
        contributionsCollection {
          contributionYears
        }
      }
    }
  `;

  console.log(`Querying account creation date and available contribution years for @${USERNAME}...`);
  const metaData = await graphql(metaQuery, { login: USERNAME });
  if (!metaData || !metaData.user) {
    throw new Error(`User @${USERNAME} not found on GitHub`);
  }

  const createdAt = new Date(metaData.user.createdAt);
  const now = new Date();
  const startYear = createdAt.getUTCFullYear();
  const currentYear = now.getUTCFullYear();

  console.log(`Account created: ${createdAt.toISOString()}`);
  console.log(`Query range: ${createdAt.toISOString()} -> ${now.toISOString()}`);

  const apiYears = (metaData.user.contributionsCollection && Array.isArray(metaData.user.contributionsCollection.contributionYears))
    ? metaData.user.contributionsCollection.contributionYears.slice().sort((a, b) => a - b)
    : [];

  const yearsToQuery = apiYears.length > 0
    ? apiYears
    : Array.from({ length: currentYear - startYear + 1 }, (_, i) => startYear + i);

  const windows = yearsToQuery.map(y => {
    const from = (y === startYear)
      ? createdAt.toISOString()
      : new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)).toISOString();
    const to = (y === currentYear)
      ? now.toISOString()
      : new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)).toISOString();
    return { year: y, from, to };
  });

  console.log(`Querying ${windows.length} non-overlapping contribution window(s):`, windows.map(w => `${w.year} (${w.from.slice(0, 10)} to ${w.to.slice(0, 10)})`).join(', '));

  const windowQuery = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
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

  const windowResults = await Promise.all(
    windows.map(async w => {
      const data = await graphql(windowQuery, { login: USERNAME, from: w.from, to: w.to });
      const calendar = data.user.contributionsCollection.contributionCalendar;
      return {
        year: w.year,
        from: w.from,
        to: w.to,
        totalContributions: calendar.totalContributions,
        weeks: calendar.weeks,
      };
    })
  );

  const dayMap = new Map();
  let lifetimeTotal = 0;

  for (const wr of windowResults) {
    console.log(`Contribution window ${wr.year} [${wr.from.slice(0, 10)} -> ${wr.to.slice(0, 10)}]: ${wr.totalContributions} contributions`);
    lifetimeTotal += wr.totalContributions;
    for (const week of wr.weeks) {
      for (const day of week.contributionDays) {
        dayMap.set(day.date, day.contributionCount);
      }
    }
  }

  const allDays = Array.from(dayMap.entries())
    .map(([date, contributionCount]) => ({ date, contributionCount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  let longest = 0;
  let run = 0;
  for (const day of allDays) {
    if (day.contributionCount > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  let current = 0;
  for (let i = allDays.length - 1; i >= 0; i -= 1) {
    if (allDays[i].contributionCount > 0) {
      current += 1;
    } else {
      break;
    }
  }

  if (current === 0 && allDays.length > 1) {
    const last = allDays[allDays.length - 1];
    const previous = allDays[allDays.length - 2];
    if (last.contributionCount === 0 && previous.contributionCount > 0) {
      for (let i = allDays.length - 2; i >= 0; i -= 1) {
        if (allDays[i].contributionCount > 0) current += 1;
        else break;
      }
    }
  }

  fs.mkdirSync(require('path').dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, createSvg(current, longest, lifetimeTotal));

  const firstDay = allDays.length > 0 ? allDays[0].date : 'N/A';
  const lastDay = allDays.length > 0 ? allDays[allDays.length - 1].date : 'N/A';
  console.log(`Lifetime contribution period: FROM=${firstDay}, TO=${lastDay}`);
  console.log(`Lifetime Total Contributions (aggregated from GraphQL): ${lifetimeTotal}`);
  console.log(`Number of tracked contribution days: ${allDays.length}`);
  console.log(`Current streak: ${current} days`);
  console.log(`Longest streak: ${longest} days`);
  console.log(`Generated ${OUTPUT}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
