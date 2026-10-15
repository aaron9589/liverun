/** Where the in-app Help links point (the user guide on GitHub). One constant so a fork can repoint it. */
export const HELP_BASE = 'https://github.com/aaron9589/liverun/blob/main/docs/user-guide/';

export type HelpPage = 'README.md' | 'guard-panel.md' | 'crew-view.md';

export const helpUrl = (page: HelpPage = 'README.md'): string => HELP_BASE + page;
