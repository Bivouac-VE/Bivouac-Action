// Action entrypoint. Kept separate from index.ts so tests can import the
// action's logic without triggering a real run (CI environments set
// GITHUB_TOKEN / GITHUB_ACTIONS, which the old import-time guard relied on).
import { run } from './index';

void run();
