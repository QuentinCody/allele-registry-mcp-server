#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assertContains(filePath, haystack, needle, testName) {
  totalTests++;
  if (haystack.includes(needle)) {
    console.log(`${GREEN}✓${RESET} ${testName}`);
    passedTests++;
  } else {
    console.log(`${RED}✗${RESET} ${testName}`);
    console.log(`  Missing: ${needle}`);
    console.log(`  File: ${filePath}`);
    failedTests++;
  }
}

function readFile(relPath) {
  return fs.readFileSync(path.resolve(SERVER_ROOT, relPath), 'utf8');
}

console.log(`${BLUE}🧪 Allele Registry Structured Content Regression Tests${RESET}`);

// Code Mode-only server — the four tools come from the @bio-mcp/shared factories
// (createSearchTool / createExecuteTool / createQueryDataHandler /
// createGetSchemaHandler), which already emit content + structuredContent on both
// success and error paths. These assertions verify the wiring is correct.
const toolExpectations = [
  {
    path: 'src/tools/code-mode.ts',
    required: ['createSearchTool', 'createExecuteTool', 'allele_registry', 'alleleRegistryCatalog'],
  },
  {
    path: 'src/tools/query-data.ts',
    required: ['createQueryDataHandler', 'allele_registry_query_data'],
  },
  {
    path: 'src/tools/get-schema.ts',
    required: ['createGetSchemaHandler', 'allele_registry_get_schema'],
  },
];

for (const { path: filePath, required } of toolExpectations) {
  const content = readFile(filePath);
  for (const token of required) {
    assertContains(filePath, content, token, `${filePath} includes ${token}`);
  }
}

// Provenance: allele_registry_execute must declare the ClinGen Allele Registry source
const codeModeContent = readFile('src/tools/code-mode.ts');
assertContains('src/tools/code-mode.ts', codeModeContent, 'source:', 'code-mode declares a provenance source');
assertContains('src/tools/code-mode.ts', codeModeContent, 'ClinGen Allele Registry', 'provenance source names ClinGen Allele Registry');
assertContains('src/tools/code-mode.ts', codeModeContent, 'https://reg.clinicalgenome.org', 'provenance source url is reg.clinicalgenome.org');

const indexContent = readFile('src/index.ts');
assertContains('src/index.ts', indexContent, 'AlleleRegistryDataDO', 'index.ts exports AlleleRegistryDataDO');
assertContains('src/index.ts', indexContent, 'McpAgent', 'index.ts uses McpAgent');
assertContains('src/index.ts', indexContent, 'registerCodeMode', 'index.ts wires registerCodeMode');
assertContains('src/index.ts', indexContent, 'registerQueryData', 'index.ts wires registerQueryData');
assertContains('src/index.ts', indexContent, 'registerGetSchema', 'index.ts wires registerGetSchema');

// do.ts must extend the shared staging base
const doContent = readFile('src/do.ts');
assertContains('src/do.ts', doContent, 'RestStagingDO', 'do.ts extends RestStagingDO');

// http.ts must target the ClinGen Allele Registry base URL
const httpContent = readFile('src/lib/http.ts');
assertContains('src/lib/http.ts', httpContent, 'reg.clinicalgenome.org', 'http.ts targets the ClinGen Allele Registry base URL');

// wrangler.jsonc must bind ALLELE_REGISTRY_DATA_DO and use port 8905
const wranglerContent = readFile('wrangler.jsonc');
assertContains('wrangler.jsonc', wranglerContent, 'ALLELE_REGISTRY_DATA_DO', 'wrangler.jsonc binds ALLELE_REGISTRY_DATA_DO');
assertContains('wrangler.jsonc', wranglerContent, 'AlleleRegistryDataDO', 'wrangler.jsonc migrates AlleleRegistryDataDO class');
assertContains('wrangler.jsonc', wranglerContent, '"port": 8905', 'wrangler.jsonc dev port is 8905');
assertContains('wrangler.jsonc', wranglerContent, 'CODE_MODE_LOADER', 'wrangler.jsonc binds CODE_MODE_LOADER');
assertContains('wrangler.jsonc', wranglerContent, './src/ai-stub.ts', 'wrangler.jsonc aliases ai to the stub');

console.log(`\n${BLUE}📊 Test Results Summary${RESET}`);
console.log(`Total tests: ${totalTests}`);
console.log(`${GREEN}Passed: ${passedTests}${RESET}`);
console.log(`${RED}Failed: ${failedTests}${RESET}`);

if (failedTests > 0) {
  console.log(`\n${RED}❌ Regression tests failed.${RESET}`);
  process.exit(1);
}

console.log(`\n${GREEN}✅ Allele Registry structured content regression tests passed.${RESET}`);
