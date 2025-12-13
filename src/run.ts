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

export async function scren(page: Page, caption: string = '', fullPage: boolean = false) {
  try {
    const imageBuffer = await page.screenshot({ type: 'png', fullPage });
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


export async function run(headless: boolean = true) {
  const { browser, page } = await launchBrowser(headless);

  try {
    // Переходим на страницу с копи-трейдингом
    await page.goto('https://www.bitget.com/ru/copy-trading/futures/all', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Автоскролл первой страницы
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 200;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    await scren(page, 'Страница 1');

    // Цикл по кнопке "Следующая"
    for (let i = 1; i < 100; i++) { // 100 — максимум, можно больше
      try {
        // Ждем, что кнопка доступна
        const nextBtn = await page.waitForSelector('li.bit-pagination-next[aria-disabled="false"] button', { timeout: 5000 });
        await nextBtn.click();
        console.log(`Кликнули по следующей странице: ${i + 1}`);

        // Пауза после клика
        await page.waitForTimeout(3000);

        // Перезагрузка страницы для надежности
        await page.reload({ waitUntil: 'networkidle' });
        console.log(`Страница ${i + 1} перезагружена`);

        // Автоскролл страницы
        await page.evaluate(async () => {
          await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 200;
            const timer = setInterval(() => {
              window.scrollBy(0, distance);
              totalHeight += distance;
              if (totalHeight >= document.body.scrollHeight) {
                clearInterval(timer);
                resolve();
              }
            }, 100);
          });
        });

        // Скриншот страницы
        await scren(page, `Страница ${i + 1}`);
      } catch (err) {
        console.log('Кнопка следующей страницы недоступна или ошибка:', err);
        break; // если кнопка не доступна — выходим из цикла
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

