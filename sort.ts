import fs from 'fs';
import path from 'path';

// Пути к файлам
const inputFile = path.resolve('links.txt');
const outputFile = path.resolve('ids.txt');

// Читаем файл со ссылками
const fileContent = fs.readFileSync(inputFile, 'utf-8');
const lines = fileContent.split(/\r?\n/);

const ids: string[] = [];

lines.forEach((href) => {
    if (href.includes('copy-trading/trader/') && href.includes('/futures')) {
        const match = href.match(/copy-trading\/trader\/(.*?)\/futures/);
        if (match && match[1]) {
            ids.push(match[1]);
        }
    }
});

// Сохраняем ID в файл
fs.writeFileSync(outputFile, ids.join('\n'), 'utf-8');

console.log(`Найдено ${ids.length} ID. Сохранено в ${outputFile}`);

