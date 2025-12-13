import { launchBrowser } from './launch';
import { Page } from 'playwright';
import axios from 'axios';
import fs from 'fs';
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

async function sendFileToTelegram(filePath: string, caption: string) {
  try {
    const formData = new FormData();
    formData.append('chat_id', config.chatId);
    formData.append('caption', caption);
    formData.append('document', fs.createReadStream(filePath));

    await axios.post(`https://api.telegram.org/bot${config.OUR_BOT_TOKEN}/sendDocument`, formData, {
      headers: formData.getHeaders(),
    });

    console.log('Файл отправлен в Telegram:', filePath);
  } catch (err) {
    console.error('Ошибка при отправке файла в Telegram:', err);
  }
}
export async function scren(page: Page, caption: string) {
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


async function run(headless: boolean = true) {
  const { browser, page } = await launchBrowser(headless);
  try {

        await page.goto('https://www.bitget.com/ru/copy-trading/futures/all', {
            waitUntil: 'networkidle',
            timeout: 60000,
        });

        await page.waitForSelector('body', { timeout: 60000 });
        await page.waitForTimeout(3000);

        await autoScroll(page);          // ⬅ автоскролл
        await page.waitForTimeout(2000); // ⬅ дать догрузиться
    
        await scren(page, 'Bitget');
        let pageIndex = 1;

        while (true) {
            console.log(`Страница ${pageIndex}`);

            await autoScroll(page);
            await page.waitForTimeout(1000);

            const traderIds = await collectTraderIds(page);
            traderIds.forEach(id => console.log('Трейдер:', id));

            try {
                const nextBtn = page.locator('li.bit-pagination-next button');

                await nextBtn.waitFor({ timeout: 3000 });
                await nextBtn.click();

                await page.waitForLoadState('domcontentloaded');
                await page.waitForTimeout(1500);

                pageIndex++;
            } catch {
                console.log('Кнопка "Вперед" недоступна — конец');
                break;
            }
        }

        } catch (err) {
            console.error('Ошибка в run:', err);
        } finally {
            await browser.close();
        }
    }


(async () => {
  await run(false);
  //await run();

})();

