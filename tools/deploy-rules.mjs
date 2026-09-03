import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';

const sa = JSON.parse(readFileSync('./service-account.json', 'utf8'));
const app = initializeApp({ credential: cert(sa) });
const token = await app.options.credential.getAccessToken();

// Let's test deploying updated rules
export async function deployRules(rulesContent) {
  console.log('Creating ruleset...');
  const createRes = await fetch('https://firebaserules.googleapis.com/v1/projects/denzozsaas/rulesets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      source: {
        files: [{ name: 'firestore.rules', content: rulesContent }]
      }
    })
  });
  const createData = await createRes.json();
  if (!createRes.ok) {
    console.error('Failed to create ruleset:', createData);
    return false;
  }
  console.log('Ruleset created:', createData.name);

  console.log('Updating release to point to new ruleset...');
  const updateRes = await fetch(`https://firebaserules.googleapis.com/v1/projects/denzozsaas/releases/cloud.firestore`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      release: {
        name: 'projects/denzozsaas/releases/cloud.firestore',
        rulesetName: createData.name
      }
    })
  });
  const updateData = await updateRes.json();
  if (!updateRes.ok) {
    console.error('Failed to update release:', updateData);
    return false;
  }
  console.log('Rules deployed successfully!');
  return true;
}

// Read current local firestore.rules
let rules = readFileSync('../firestore.rules', 'utf8');
console.log('Testing deployment of current rules...');
await deployRules(rules);
