const fs = require('fs');
const { performance } = require('perf_hooks');

const debug = (obj, name = 'out.json', raw = false) => global.DEBUG_LOGGING && fs.writeFileSync(name, raw ? obj : JSON.stringify(obj, null, '  '));

const time = (str, fn) => {
  const now =  performance.now();
  const retVal = fn();
  const stopwatch = performance.now() - now;
  let startCode = '\x1b[32m';
  if (stopwatch > 10000) {
    startCode = '\x1b[31m';
  } else if (stopwatch > 1000) {
    startCode = '\x1b[33m';
  }
  console.log(`${str}:`, `${startCode}${prettyFloat(stopwatch,false)}ms\x1b[0m`);
  return retVal;
};

const byteScale = [
  'b',
  'kb',
  'mb',
  'gb',
  'tb',
  'pb',
];

const prettyBytes = (n, suffix = '', color = true) => {
  let i = 0;
  let num = n;
  while(num > 10000) {
    i++;
    num /= 1024;
  }
  return `${color?'\x1b[1m\x1b[36m':''}${prettyFloat(num, false, 2)}${byteScale[i]}${suffix}${color?'\x1b[0m':''}`;
};

const prettyFloat = (n, color = true, prec = 3) => {
  const f = Math.round((n - Math.floor(n)) * 10**prec);
  const s = prettyInt(n, false);
  return `${color?'\x1b[36m':''}${s}.${f}${color?'\x1b[0m':''}`;
};

const prettyInt = (n, color = true) => {
  const arr = n.toFixed(0).split('');
  const l = arr.length;
  const s = arr.reduceRight((a, e, i) => {
    const rIndex = l - (i + 1);
    if (i !== l - 1 && rIndex % 3 === 0) {
      return e + ',' + a;
    }
    return e + a;
  }, '');
  return `${color?'\x1b[36m':''}${s}${color?'\x1b[0m':''}`;
};

module.exports = {
  debug,
  time,
  prettyInt,
  prettyFloat,
  prettyBytes,
};