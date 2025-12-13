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
    // Путь к файлу с ID
    const idsFile = path.resolve('ids.txt'); // если нужно, можно сделать параметром функции
    if (!fs.existsSync(idsFile)) {
        console.error('Файл ids.txt не найден!');
        return;
    }

    // Читаем все ID
    const fileContent = fs.readFileSync(idsFile, 'utf-8');
    const ids = fileContent.split(/\r?\n/).filter(Boolean); // убираем пустые строки

    const { browser, page } = await launchBrowser(headless);

    for (const id of ids) {
        const url = `https://www.bitget.com/ru/copy-trading/trader/${id}/futures`;

        try {
            console.log(`Открываю страницу: ${url}`);
            await page.goto(url);

            // Ждем, чтобы страница полностью прогрузилась
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Тут выполняем нужные действия, например скриншот
            await scren(page, `Скриншот для ${id}`);

            // Если нужно кликнуть на кнопки и ждать
            try {
                const nextBtn = await page.waitForSelector('li.bit-pagination-next[aria-disabled="false"] button', { timeout: 5000 });
                await nextBtn.click();
                await new Promise(resolve => setTimeout(resolve, 5000)); // задержка после клика
                await page.reload({ waitUntil: 'networkidle' }); // перезагрузка страницы
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (err) {
                console.log(`Кнопка следующей страницы недоступна или ошибка для ID ${id}:`, err);
            }

        } catch (err) {
            console.error(`Ошибка при обработке ID ${id}:`, err);
        }
    }

    await browser.close();
}

(async () => {

  await run(false);
  //await run();

})();

