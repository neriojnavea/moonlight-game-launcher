'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (payload) => ipcRenderer.invoke(channel, payload);
const on = (channel) => (fn) => {
  const wrapped = (_e, data) => fn(data);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('launcher', {
  library: {
    get: invoke('library:get'),
    resync: invoke('library:resync'),
    onUpdated: on('library:updated'),
  },
  game: {
    play: invoke('game:play'),
    launch: invoke('game:launch'),
    suspend: invoke('game:suspend'),
    resume: invoke('game:resume'),
    close: invoke('game:close'),
    forceKill: invoke('game:forceKill'),
    clearStale: invoke('game:clearStale'),
    focus: invoke('game:focus'),
  },
  state: {
    get: invoke('state:get'),
    onUpdated: on('state:updated'),
  },
  nav: {
    returnToGame: invoke('nav:returnToGame'),
    showLibrary: invoke('nav:showLibrary'),
    hide: invoke('nav:hide'),
    onVisibility: on('visibility'),
  },
  config: {
    get: invoke('config:get'),
    set: invoke('config:set'),
    onUpdated: on('config:updated'),
  },
  input: {
    onAction: on('pad:action'),
    onDirs: on('pad:dirs'),
    onBrand: on('pad:brand'),
  },
  sys: {
    stats: invoke('sys:stats'),
    onStats: on('sys:stats'),
  },
  debug: {
    logTail: invoke('debug:logTail'),
    subscribeLogs: invoke('debug:subscribeLogs'),
    unsubscribeLogs: invoke('debug:unsubscribeLogs'),
    onLogData: on('debug:logData'),
    subscribeInput: invoke('debug:subscribeInput'),
    unsubscribeInput: invoke('debug:unsubscribeInput'),
    onInputEvent: on('debug:inputEvent'),
    onDevices: on('debug:devices'),
    stateFiles: invoke('debug:stateFiles'),
    action: invoke('debug:action'),
  },
  system: {
    info: invoke('system:info'),
  },
});
