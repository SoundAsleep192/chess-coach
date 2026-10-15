// Поддельный UCI-движок для тестов пула и контроллера. Позиция, начинающаяся с метки --hang, не получает ответа,
// с метки --crash - процесс падает, --once FILE - второй и следующие запуски сразу выходят. --delay N - пауза перед bestmove, --log FILE - журнал полученных команд.
import { appendFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const delay = Number(opt('--delay', '0'));
const log = opt('--log');
const hang = opt('--hang', 'hang');
const crash = opt('--crash', 'crash');
const out = (line) => process.stdout.write(`${line}\n`);
const once = opt('--once');
if (once) {
  // только первый запуск работает: следующие падают сразу (проверка неудачного перезапуска)
  if (existsSync(once)) process.exit(1);
  appendFileSync(once, 'started\n');
}
let multipv = 1;
let fen = '';

createInterface({ input: process.stdin }).on('line', (line) => {
  if (log) appendFileSync(log, `${process.pid} ${line}\n`);
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (cmd === 'uci') {
    out('id name FakeFish 1');
    out('uciok');
  } else if (cmd === 'isready') {
    out('readyok');
  } else if (cmd === 'setoption' && rest[1] === 'MultiPV') {
    multipv = Number(rest[3]);
  } else if (cmd === 'position') {
    fen = rest.slice(1).join(' ');
  } else if (cmd === 'go') {
    if (fen.startsWith(hang)) return;
    if (fen.startsWith(crash)) process.exit(3);
    const nodes = rest[rest.indexOf('nodes') + 1];
    const at = rest.indexOf('searchmoves');
    const moves = at >= 0 ? rest.slice(at + 1) : ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'b1c3'];
    setTimeout(() => {
      for (let i = 1; i <= Math.min(multipv, moves.length); i++) {
        out(`info depth 7 seldepth 9 multipv ${i} score cp ${100 - i} nodes ${nodes} pv ${moves[i - 1]} e7e5`);
      }
      out(`bestmove ${moves[0]}`);
    }, delay);
  } else if (cmd === 'quit') {
    process.exit(0);
  }
});
