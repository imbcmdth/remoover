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
  console.log(`${str}:`, `${startCode}${prettyFloat(stopwatch, '', false)}ms\x1b[0m`);
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

// Scales the input down by 2**10 until the value is less than 10k
// and appends the proper *byte suffix to the remaining value
const prettyBytes = (n, suffix = '', color = true) => {
  let i = 0;
  let num = n;
  while(num > 10000) {
    i++;
    num /= 1024;
  }
  return `${color?'\x1b[1m\x1b[36m':''}${prettyFloat(num, '', false, 2)}${byteScale[i]}${suffix}${color?'\x1b[0m':''}`;
};

// Basically, Number#toFixed with color and thousands dividers
const prettyFloat = (n, suffix = '', color = true, prec = 3) => {
  const localeOptions = {
    minimumFractionDigits: prec,
    maximumFractionDigits: prec,
  };
  const s = n.toLocaleString(undefined, localeOptions);
  return `${color?'\x1b[36m':''}${s}${suffix}${color?'\x1b[0m':''}`;
};

// Basically, Number#toFixed with color!
const prettyInt = (n, color = true) => {
  const localeOptions = {
    maximumFractionDigits: 0
  };
  const s = n.toLocaleString(undefined, localeOptions);
  return `${color?'\x1b[36m':''}${s}${color?'\x1b[0m':''}`;
};

// Count only non-escape codes charactors. Used to determine the
// number of backspaces needed in certain circumstances
const stringLen = (str) => str.replace(/\u001b[^m]+m/g, '').length;

const backspace = (num = 1) => new Array(num + 1).join('\b');

module.exports = {
  debug,
  time,
  prettyInt,
  prettyFloat,
  prettyBytes,
  stringLen,
  backspace,
};