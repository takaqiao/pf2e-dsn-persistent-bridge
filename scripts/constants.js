export const MOD_ID='pf2e-dsn-persistent-bridge';
export const SETTINGS={enabled:'enabled',traySize:'traySize',autoSubmitOnFill:'autoSubmitOnFill',verboseLogging:'verboseLogging'};
export const getSetting=key=>{try{return globalThis.game.settings.get(MOD_ID,key);}catch{return undefined;}};
export const warn=(...args)=>console.warn('Persistent Dice:',...args);
export const log=(...args)=>{if(getSetting(SETTINGS.verboseLogging)) console.debug('Persistent Dice:',...args);};
