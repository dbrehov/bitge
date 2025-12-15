import { launchBrowser } from './launch';
import { Page } from 'playwright';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import config from './config';

async function sendToTelegram(message: string) {
  try {
    await axios.get(`https://api.telegram.org/bot${config.OUR_BOT_TOKEN}/sendMessage`, {
      params: { chat_id: config.chatId, text: message },
    });
    console.log('Сообщение отправлено в Telegram:', message);
  } catch (err) {
    console.error('Ошибка при отправке в Telegram:', err);
  }
}

async function sendFileToTelegramFromMemory(content: string, filename: string, caption: string) {
  try {
    const formData = new FormData();
    formData.append('chat_id', config.chatId);
    formData.append('caption', caption);

    // передаём Buffer и указываем имя файла
    formData.append('document', Buffer.from(content, 'utf-8'), { filename });

    await axios.post(`https://api.telegram.org/bot${config.OUR_BOT_TOKEN}/sendDocument`, formData, {
      headers: formData.getHeaders(),
    });

    console.log('Файл отправлен в Telegram (из памяти)');
  } catch (err) {
    console.error('Ошибка при отправке файла в Telegram:', err);
  }
}

async function scren(page: Page, caption: string) {
  try {
    const imageBuffer = await page.screenshot({ type: 'png', fullPage: false });
    const formData = new FormData();
    formData.append('chat_id', config.chatId);
    formData.append('caption', caption);
    formData.append('photo', imageBuffer, { filename: 'screenshot.png', contentType: 'image/png' });
    await axios.post(`https://api.telegram.org/bot${config.OUR_BOT_TOKEN}/sendPhoto`, formData, { headers: formData.getHeaders() });
    console.log('Скриншот отправлен в Telegram с caption:', caption);
  } catch (err) {
    console.error('Ошибка при скриншоте или отправке в Telegram:', err);
  }
}

async function autoScroll(page: Page) {
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 800;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

async function collectTraderIds(page: Page): Promise<string[]> {
  const ids = await page.evaluate(() => {
    const result: string[] = [];
    const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];

    for (const a of links) {
      const href = a.getAttribute('href');
      if (!href) continue;

      if (href.includes('copy-trading/trader/') && href.includes('/futures')) {
        const match = href.match(/copy-trading\/trader\/([^/]+)\/futures/);
        if (match && match[1]) result.push(match[1]);
      }
    }

    return Array.from(new Set(result)); // убираем дубли
  });

  return ids;
}

async function closeRestrictedIpByKeyboard(page: any) {
    try {
        // Ждём появления диалога
        await page.waitForSelector(
            'div[role="dialog"][aria-label]',
            { timeout: 5000 }
        );

        console.log('Restricted IP popup detected (keyboard mode)');

        // Даём странице установить фокус
        await page.waitForTimeout(500);

        // Последовательность TAB до чекбокса и кнопки
        // Обычно хватает 3–6 TAB, но делаем с запасом
        for (let i = 0; i < 6; i++) {
            await page.keyboard.press('Tab');
            await page.waitForTimeout(150);
        }

        // SPACE — отметить чекбокс
        await page.keyboard.press('Space');
        await page.waitForTimeout(300);

        // ещё TAB до кнопки "Continue"
        for (let i = 0; i < 3; i++) {
            await page.keyboard.press('Tab');
            await page.waitForTimeout(150);
        }

        // ENTER — подтвердить
        await page.keyboard.press('Enter');

        await page.waitForTimeout(1500);
        console.log('Restricted IP popup closed via keyboard');
    } catch (e) {
        console.log('Restricted IP popup not shown');
    }
}



async function run1(headless: boolean = true) {
    const idsFile = path.resolve('ids.txt');

    const ids = fs
        .readFileSync(idsFile, 'utf-8')
        .split(/\r?\n/)
        .filter(Boolean);

    const results: string[] = [];

    const { browser, page } = await launchBrowser(headless);

    for (const id of ids) {
        const url = `https://www.bitget.com/ru/copy-trading/trader/${id}/futures`;

        try {
            console.log(`\n===== ${id} =====`);
            await page.goto(url, { waitUntil: 'networkidle' });

            const pageText = await page.evaluate(() => document.body.innerText);

            const lines = pageText
                .split('\n')
                .map(l => l.trim())
                .filter(Boolean);

            const pnlIndex = lines.findIndex(line => line === 'PnL (%)');

            let valueLine = 'NOT_FOUND';
            if (pnlIndex > 0) {
                valueLine = lines[pnlIndex - 1];
            }

            console.log(valueLine);
            results.push(`ID: ${id} | Profit: ${valueLine}`);
        } catch (err) {
            console.error(`Ошибка для ${id}:`, err);
            results.push(`ID: ${id} | ERROR`);
        }
    }

    await browser.close();

    // Отправка файла в Telegram без сохранения на диск
// после сбора всех results
const fileContent = results.join('\n');

await sendFileToTelegramFromMemory(
    fileContent,
    'copy_trading_result.txt',
    `Результаты копитрейдинга (${results.length})`
);

}



async function run0(headless: boolean = true) {
    const idsFile = path.resolve('ids.txt');

    const ids = fs
        .readFileSync(idsFile, 'utf-8')
        .split(/\r?\n/)
        .filter(Boolean);

    const results: string[] = [];

    const { browser, page } = await launchBrowser(headless);

    for (const id of ids) {



        const url = `https://www.bitget.com/ru/copy-trading/trader/${id}/futures-order`;
        // обязательно сразу после загрузки



        try {
            console.log(`\n===== ${id} =====`);



            await page.goto(url, { waitUntil: 'networkidle' });
            //await page.goto("https://www.bitget.com/ru/copy-trading/trader/b0b34f758dbb3d52a091/futures-order", { waitUntil: 'networkidle' });


            try {
                try {
                    // Ждём кнопку "Вперед" в DOM (можно задать короткий timeout)
                    const nextButton = await page.waitForSelector(
                        'li.bit-pagination-next[aria-disabled="false"] > button.bit-pagination-item-link',
                        { timeout: 3000 } // короткий таймаут, чтобы не тормозить
                     );

                    // Нажимаем кнопку
                await nextButton.click();
                console.log('Clicked "Вперед" button');

            } catch {
                console.log('"Вперед" button not found or disabled');
}


                await new Promise(resolve => setTimeout(resolve, 5000)); // задержка после клика
                // Press enter


                //await page.keyboard.press("Enter");
            } catch (err) {
                console.log(`Кнопка следующей страницы недоступна:`, err);
            }
            const pageText = await page.evaluate(() => document.body.innerText);

            const lines = pageText
                .split('\n')
                .map(l => l.trim())
                .filter(Boolean);
            //console.log(lines)
            const pnlIndex = lines.findIndex(line => line === 'Ордер №');

            let valueLine = 'NOT_FOUND';
            if (pnlIndex > 0) {
                valueLine = lines[pnlIndex + 9];       
            }

            console.log(valueLine);
            results.push(`ID: ${id} | Profit: ${valueLine}`);
        } catch (err) {
            console.error(`Ошибка для ${id}:`, err);
            results.push(`ID: ${id} | ERROR`);
        }

    await scren(page, 'Это скриншот');
    }
    await browser.close();

    // Отправка файла в Telegram без сохранения на диск
// после сбора всех results
const fileContent = results.join('\n');

await sendFileToTelegramFromMemory(
    fileContent,
    'copy_trading_result.txt',
    `Результаты копитрейдинга (${results.length})`
);

}


async function run4(headless: boolean = true) {
    const { browser, page } = await launchBrowser(headless);

    try {
        await page.goto(
            'https://www.bitget.com/ru/copy-trading/trader/b0b34f758dbb3d52a091/futures-order',
            { waitUntil: 'networkidle' }
        );

        // Ждём pop-up "Ограничение по IP"
        const popup = await page.waitForSelector(
            'div.mi-overlay div[role="dialog"][aria-label="Ограничение по IP"]',
            { timeout: 15000, state: 'visible' }
        );

        const text = await popup.evaluate(el => (el as HTMLElement).innerText);
        console.log('POPUP TEXT:\n', text);

    } catch (err) {
        console.log('Popup not found within timeout or selector mismatch');
    } finally {
        // await browser.close();
    }
}

async function run(headless: boolean = true) {
    const idsFile = path.resolve('ids.txt');

    const ids = fs
        .readFileSync(idsFile, 'utf-8')
        .split(/\r?\n/)
        .filter(Boolean);

    const results: string[] = [];

    const { browser, page } = await launchBrowser(headless);

    for (const id of ids) {
        const url = `https://www.bitget.com/ru/copy-trading/trader/${id}/futures-order`;

        try {
            console.log(`\n===== ${id} =====`);
            await page.goto(url, { waitUntil: 'networkidle' });

            // ---------- POP-UP ----------
            try {
                await page.waitForSelector(
                    'div.mi-overlay div[role="dialog"][aria-label="Ограничение по IP"]',
                    { state: 'visible', timeout: 20000 }
                );

                console.log('Pop-up detected, using keyboard to interact');

                await page.focus('body');
                await page.keyboard.press('Tab');
                await page.keyboard.press('Space');
                await page.keyboard.press('Tab');
                await page.keyboard.press('Enter');

                await page.waitForTimeout(3000);
            } catch (err) {
                console.log('Pop-up not found or keyboard handling failed');
            }

            // ---------- КНОПКА ----------
            try {
                await page.waitForFunction(() => {
                    const buttons = Array.from(
                        document.querySelectorAll<HTMLButtonElement>('button.bit-button')
                    );
                    return buttons.some(
                        btn =>
                            btn.offsetParent !== null &&
                            btn.innerText.trim() === 'Активные элитные сделки'
                    );
                }, { timeout: 15000 });

                const buttons = await page.$$('button.bit-button');
                let targetButton = null;

                for (const btn of buttons) {
                    const text = (await btn.innerText()).trim();
                    const box = await btn.boundingBox();
                    if (text === 'Активные элитные сделки' && box) {
                        targetButton = btn;
                        break;
                    }
                }

                if (!targetButton) {
                    console.log('Target button not found');
                } else {
                    await targetButton.scrollIntoViewIfNeeded();
                    await targetButton.click({ force: true });
                    console.log('Clicked "Активные элитные сделки"');
                }
            } catch (err) {
                console.log('Failed to click the correct button:', err);
            }

            await scren(page, 'Это скриншот');

            // ---------- ЧТЕНИЕ ТЕКСТА ----------
            try {
                const pageText = await page.evaluate(() => document.body.innerText);

                const lines = pageText
                    .split('\n')
                    .map(l => l.trim())
                    .filter(Boolean);

                const startIndex = lines.findIndex(line => line === 'Ордер №');
                const endIndex = lines.findIndex(line => line === 'О Bitget');

                if (startIndex >= 0) {
                    const sliceStart = startIndex + 1; // после "Ордер №"
                    const sliceEnd = endIndex > sliceStart ? endIndex : lines.length;

                    const orderLines = lines.slice(sliceStart, sliceEnd); // массив строк

                    // Обработка даты и времени для сортировки
                    const dateTimeRegex = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

                    const processedLines = orderLines.map(line => {
                        if (dateTimeRegex.test(line)) {
                            const dt = new Date(line);
                            return dt.toISOString().replace(/[-:T]/g, '').slice(0, 14);
                        }
                        return line;
                    });

                    // Отправляем каждую строку в Telegram построчно
                    for (const line of processedLines) {
                        await sendToTelegram(line);
                    }

                    // Склеиваем строку для сохранения в results
                    const orderText = processedLines.join(' ');
                    results.push(`ID: ${id} | Profit: ${orderText}`);
                } else {
                    results.push(`ID: ${id} | NOT_FOUND`);
                }

            } catch (err) {
                console.error(`Ошибка парсинга для ${id}:`, err);
                results.push(`ID: ${id} | ERROR`);
            }

        } catch (err) {
            console.log('Error handling page navigation:', err);
            results.push(`ID: ${id} | ERROR`);
        }
    }

    await browser.close();

    const fileContent = results.join('\n');

    await sendFileToTelegramFromMemory(
        fileContent,
        'copy_trading_result.txt',
        `Результаты копитрейдинга (${results.length})`
    );
}



 (async () => {

  await run(false);
  //await run();

})();

