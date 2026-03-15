// packages/cli/src/commands/harvest.ts
import type { Command } from 'commander';
import type { FragmintClient } from '../client.js';

export function registerHarvestCommand(program: Command, getClient: () => FragmintClient) {
  program
    .command('harvest <file>')
    .description('Harvest fragments from a DOCX file')
    .option('--min-confidence <n>', 'Minimum confidence threshold', '0.65')
    .option('--collection <slug>', 'Collection slug', 'common')
    .option('--json', 'Output raw JSON')
    .action(async (filePath, opts) => {
      const client = getClient();
      const minConfidence = parseFloat(opts.minConfidence);

      console.log(`Uploading ${filePath}...`);
      const { job_id } = await client.uploadHarvest(filePath, minConfidence, opts.collection);
      console.log(`Job created: ${job_id}`);

      // Poll until done
      let job: any;
      while (true) {
        job = await client.collectionRequest('GET', `/harvest/${job_id}`, opts.collection);
        if (job.status === 'done' || job.status === 'error') break;
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 2000));
      }
      console.log('');

      if (job.status === 'error') {
        console.error(`Error: ${job.error}`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(job, null, 2));
        return;
      }

      console.log(`\nResults: ${job.stats?.total ?? 0} candidates`);
      console.log(`  Valid: ${job.stats?.valid ?? 0}`);
      console.log(`  Duplicates: ${job.stats?.duplicates ?? 0}`);
      console.log(`  Low confidence: ${job.stats?.low_confidence ?? 0}`);

      if (job.candidates) {
        console.log('\nCandidates:');
        for (const c of job.candidates) {
          const conf = (c.confidence * 100).toFixed(0);
          const dup = c.duplicate_of ? ` [DUP: ${c.duplicate_of}]` : '';
          console.log(`  [${conf}%] ${c.type}/${c.domain} — ${c.title}${dup}`);
        }
      }
    });
}
