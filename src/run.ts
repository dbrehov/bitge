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
            { state: 'visible', timeout: 20000 }
        );

        console.log('Pop-up detected, using keyboard to interact');

        await page.focus('body');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Space');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');

        await page.waitForTimeout(3000);

        popupHandled = true;
    } catch {
        console.log('Pop-up not found or keyboard handling failed');
        popupHandled = true;
    }
}

async function parseOrdersFromPage(
    page: Page,
    symbolFilter: string | null,
    hoursThreshold: number
): Promise<string[]> {

    const pageText = await page.evaluate(() => document.body.innerText);

    const lines = pageText
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

    const startIndex = lines.findIndex(line => line === 'Ордер №');
    const endIndex   = lines.findIndex(line => line === 'О Bitget');

    if (startIndex < 0) return [];

    const sliceStart = startIndex + 1;
    const sliceEnd   = endIndex > sliceStart ? endIndex : lines.length;

    const orderLines = lines.slice(sliceStart, sliceEnd);

    const blocks: string[][] = [];
    let block: string[] = [];

    for (const line of orderLines) {
        block.push(line);

        if (
            /^\d{19}$/.test(line) &&
            block.join(' ').includes('USDT') &&
            block.join(' ').length >= 5
        ) {
            blocks.push(block);
            block = [];
        }
    }

    const now = new Date();
    const thresholdTime = new Date(
        now.getTime() - hoursThreshold * 60 * 60 * 1000
    );

    console.log(
        `Собираем строки не позднее ${hoursThreshold} часов назад (${thresholdTime.toISOString()})`
    );

    const result: string[] = [];

    for (const b of blocks) {
        if (symbolFilter && !b[0].includes(symbolFilter)) continue;

        const dateStr = b[6];
        const date = new Date(dateStr);

        if (isNaN(date.getTime())) {
            console.log('Неверный формат даты/времени в блоке:', b);
            continue;
        }

        if (date >= thresholdTime) {
            result.push(b.join(' '));
        }
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

    for (const id of ids) {
        const url = `https://www.bitget.com/ru/copy-trading/trader/${id}/futures-order`;

        try {
            console.log(`\n===== ${id} =====`);
            await page.goto(url, { waitUntil: 'networkidle' });

            await handleIpPopupOnce(page);

            // ---------- КНОПКА ----------
            try {
                await page.waitForFunction(() => {
                    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button.bit-button'));
                    return buttons.some(
                        (btn) => btn.offsetParent !== null && btn.innerText.trim() === 'Активные элитные сделки'
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

            const parsedBlocks = await parseOrdersFromPage(page, symbolFilter, hoursThreshold);

            await scren(page, 'Это скриншот');

            for (const blockText of parsedBlocks) {
                await sendToTelegram(blockText);
                results.push(`ID: ${id} | Profit: ${blockText}`);
            }

            if (parsedBlocks.length === 0) {
                results.push(`ID: ${id} | NOT_FOUND`);
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
}(async () => {
    await run(null, 200, false);
})();

