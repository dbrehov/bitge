import { launchBrowser } from './launch';
import { Page } from 'playwright';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import config from './config';

let popupHandled = false;

async function sendToTelegram(message: string) {
    try {
        await axios.get(
            `https://api.telegram.org/bot${config.OUR_BOT_TOKEN}/sendMessage`,
            {
                params: {
                    chat_id: config.chatId,
                    text: message,
                },
            }
        );
        console.log('Сообщение отправлено в Telegram:', message);
    } catch (err) {
        console.error('Ошибка при отправке в Telegram:', err);
    }
}

async function sendFileToTelegramFromMemory(
    content: string,
    filename: string,
    caption: string
) {
    try {
        const formData = new FormData();
        formData.append('chat_id', config.chatId);
        formData.append('caption', caption);
        formData.append(
            'document',
            Buffer.from(content, 'utf-8'),
            { filename }
        );

        await axios.post(
            `https://api.telegram.org/bot${config.OUR_BOT_TOKEN}/sendDocument`,
            formData,
            { headers: formData.getHeaders() }
        );

        console.log('Файл отправлен в Telegram (из памяти)');
    } catch (err) {
        console.error('Ошибка при отправке файла в Telegram:', err);
    }
}

async function scren(page: Page, caption: string) {
    try {
        const imageBuffer = await page.screenshot({
            type: 'png',
            fullPage: false,
        });

        const formData = new FormData();
        formData.append('chat_id', config.chatId);
        formData.append('caption', caption);
        formData.append('photo', imageBuffer, {
            filename: 'screenshot.png',
            contentType: 'image/png',
        });

        await axios.post(
            `https://api.telegram.org/bot${config.OUR_BOT_TOKEN}/sendPhoto`,
            formData,
            { headers: formData.getHeaders() }
        );

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
        const links = Array.from(
            document.querySelectorAll('a[href]')
        ) as HTMLAnchorElement[];

        for (const a of links) {
            const href = a.getAttribute('href');
            if (!href) continue;

            if (
                href.includes('copy-trading/trader/') &&
                href.includes('/futures')
            ) {
                const match = href.match(
                    /copy-trading\/trader\/([^/]+)\/futures/
                );
                if (match && match[1]) {
                    result.push(match[1]);
                }
            }
        }

        return Array.from(new Set(result));
    });

    return ids;
}

async function handleIpPopupOnce(page: Page) {
    if (popupHandled) return;

    try {
        await page.waitForSelector(
            'div.mi-overlay div[role="dialog"][aria-label="Ограничение по IP"]',
            { state: 'visible', timeout: 15000 }
        );

        console.log('Pop-up detected, handling once');

        await page.focus('body');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Space');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');

        await page.waitForTimeout(3000);

        popupHandled = true;
    } catch {
        console.log('Pop-up not found');
    }
}      

function parseOrderBlocks(
    lines: string[],
    symbolFilter: string | null,
    thresholdTime: Date
) {
    const result = [];

    const startIndex = lines.findIndex(l => l === 'Ордер №');
    if (startIndex < 0) return result;

    const endIndex = lines.findIndex(l => l === 'О Bitget');
    const sliceEnd = endIndex > startIndex ? endIndex : lines.length;

    const orderLines = lines.slice(startIndex + 1, sliceEnd);

    let block: string[] = [];

    for (const line of orderLines) {
        block.push(line);

        // конец сделки — 19-значный id
        if (!/^\d{19}$/.test(line)) continue;

        if (!block.some(v => v.includes('USDT'))) {
            block = [];
            continue;
        }

        if (symbolFilter && !block[0]?.includes(symbolFilter)) {
            block = [];
            continue;
        }

        const dateStr = block[6]; // YYYY-MM-DD HH:mm:ss
        const date = new Date(dateStr.replace(' ', 'T'));

        if (isNaN(date.getTime())) {
            console.log('Неверный формат даты/времени в блоке:', block);
            block = [];
            continue;
        }

        if (date < thresholdTime) {
            block = [];
            continue;
        }

        const unix = Math.floor(date.getTime() / 1000);

        result.push({
            text: block.join(' '),
            unix
        });

        block = [];
    }

    return result;
}

async function run(
    symbolFilter: string | null = null,
    hoursThreshold: number = 24,
    headless: boolean = true
) {
    const idsFile = path.resolve('ids.txt');

    const ids = fs
        .readFileSync(idsFile, 'utf-8')
        .split(/\r?\n/)
        .filter(Boolean);

    const results: string[] = [];
    const { browser, page } = await launchBrowser(headless);

    const now = new Date();
    const thresholdTime = new Date(
        now.getTime() - hoursThreshold * 60 * 60 * 1000
    );

    console.log(
        `Собираем строки не позднее ${hoursThreshold} часов назад ` +
        `(unix=${Math.floor(thresholdTime.getTime() / 1000)})`
    );

    for (const id of ids) {
        const url = `https://www.bitget.com/ru/copy-trading/trader/${id}/futures-order`;

        try {
            console.log(`\n===== ${id} =====`);
            await page.goto(url, { waitUntil: 'networkidle' });

            await handleIpPopupOnce(page);

            // кнопка "Активные элитные сделки"
            try {
                await page.waitForFunction(() => {
                    return Array.from(
                        document.querySelectorAll('button.bit-button')
                    ).some(
                        b =>
                            b.offsetParent !== null &&
                            b.textContent?.trim() === 'Активные элитные сделки'
                    );
                }, { timeout: 15000 });

                const buttons = await page.$$('button.bit-button');

                for (const btn of buttons) {
                    if ((await btn.innerText()).trim() === 'Активные элитные сделки') {
                        await btn.click({ force: true });
                        break;
                    }
                }
            } catch {
                console.log('Кнопка не найдена');
            }

            await scren(page, 'Это скриншот');

            const pageText = await page.evaluate(() => document.body.innerText);

            const lines = pageText
                .split('\n')
                .map(l => l.trim())
                .filter(Boolean);

            const blocks = parseOrderBlocks(
                lines,
                symbolFilter,
                thresholdTime
            );

            for (const b of blocks) {
                console.log(`Trade unix time: ${b.unix}`);
                await sendToTelegram(`${b.text} | unix=${b.unix}`);
                results.push(`ID: ${id} | ${b.text} | unix=${b.unix}`);
            }

            if (blocks.length === 0) {
                results.push(`ID: ${id} | NOT_FOUND`);
            }

        } catch (err) {
            console.error(`Ошибка для ${id}:`, err);
            results.push(`ID: ${id} | ERROR`);
        }
    }

    await browser.close();

    await sendFileToTelegramFromMemory(
        results.join('\n'),
        'copy_trading_result.txt',
        `Результаты копитрейдинга (${results.length})`
    );
}



(async () => {
    await run(null, 200, false);
})();

