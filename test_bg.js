const process = require('process');
// background #222222 = \x1b[48;2;34;34;34m
const bg = '\x1b[48;2;40;40;40m';
const reset = '\x1b[0m';
const clearEOL = '\x1b[K';

process.stdout.write(bg + ' > hello' + clearEOL + reset + '\n');
process.stdout.write('test\n');
