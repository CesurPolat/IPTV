import { registerPlugin } from '@capacitor/core';

import type { UpdaterPlugin } from './definitions';

const Updater = registerPlugin<UpdaterPlugin>('Updater', {
  web: () => import('./web').then((m) => new m.UpdaterWeb()),
});

export * from './definitions';
export { Updater };
