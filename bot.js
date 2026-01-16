// ===========================================
// 🤖 АВТОМАТИЧЕСКИЙ БОТ "СЕЛЕКТОР С ВЕТО"
// Работает на GitHub + Railway
// БЕСПЛАТНО и БЕЗ Google Таблиц
// ===========================================

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const path = require('path');

// === КОНСТАНТЫ ===
const CONFIG = {
  START_BALANCE: 5,      // Стартовые баллы
  VETO_COST: 3,          // Стоимость вето
  GAME_REWARD: 1,        // Награда за игру
  WEEKLY_BONUS: 1,       // Еженедельный бонус
  VOTE_HOURS: 24,        // Время на голосование
  DATA_FILE: 'data.json' // Файл данных
};

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let bot;
const data = {
  users: {},    // {123: {name: "Иван", balance: 5, ...}}
  groups: {},   // {chat123: {queue: [], current: 0}}
  games: {},    // Активные игры
  history: []   // История операций
};

// === ИНИЦИАЛИЗАЦИЯ ===
async function init() {
  console.log('🤖 Загружаю данные...');
  await loadData();
  
  // ТОКЕН БОТА (замени на свой!)
  const BOT_TOKEN = process.env.BOT_TOKEN || 'ВАШ_ТОКЕН_ОТ_BOTFATHER';
  
  if (!BOT_TOKEN || BOT_TOKEN === 'ВАШ_ТОКЕН_ОТ_BOTFATHER') {
    console.error('❌ ОШИБКА: Нужно указать токен бота!');
    console.log('📝 Как получить:');
    console.log('1. Найди в Telegram @BotFather');
    console.log('2. Отправь /newbot');
    console.log('3. Скопируй токен (цифры:буквы)');
    console.log('4. Добавь в Railway как переменную BOT_TOKEN');
    return;
  }
  
  // Создаём бота
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  
  console.log('✅ Бот запущен!');
  console.log('📱 ID бота: @' + (await bot.getMe()).username);
  
  // Настраиваем команды
  setupCommands();
  
  // Автосохранение каждые 5 минут
  setInterval(saveData, 5 * 60 * 1000);
  
  console.log('💾 Автосохранение включено');
  console.log('🎮 Бот готов к работе!');
}

// === КОМАНДЫ ===
function setupCommands() {
  // /start - главная команда
  bot.onText(/\/start/, async (msg) => {
    const user = msg.from;
    const chat = msg.chat;
    
    // Регистрируем пользователя
    await registerUser(user.id, user.first_name, user.username);
    
    const userData = data.users[user.id];
    
    const text = 
`🎮 *СЕЛЕКТОР С ВЕТО* 🤖

👋 Привет, ${user.first_name}!
💰 Твой баланс: *${userData.balance} баллов*

📋 *Основные команды:*
/start_system - Запустить в группе
/select [игра] - Выбрать игру
/veto - Наложить вето
/balance - Мой баланс
/top - Таблица лидеров
/rules - Правила
/me - Моя статистика
/help - Помощь

💰 *Система баллов:*
• Старт: ${CONFIG.START_BALANCE} баллов
• Игра: +${CONFIG.GAME_REWARD} балл
• Вето: -${CONFIG.VETO_COST} балла
• Понедельник: +${CONFIG.WEEKLY_BONUS} балл

⚡ *Всё автоматически! Бот сам считает баллы.*`;
    
    bot.sendMessage(chat.id, text, { parse_mode: 'Markdown' });
  });
  
  // /start_system - запуск в группе
  bot.onText(/\/start_system/, async (msg) => {
    const chat = msg.chat;
    const user = msg.from;
    
    // Только для групп
    if (chat.type === 'private') {
      bot.sendMessage(chat.id, '❌ Эту команду используй в группе!');
      return;
    }
    
    // Регистрируем всех участников
    const members = [user]; // В реальности нужно получить список участников
    
    for (const member of members) {
      await registerUser(member.id, member.first_name, member.username);
    }
    
    // Создаём очередь
    const queue = members.map(m => m.id);
    data.groups[chat.id] = {
      name: chat.title,
      queue: queue,
      currentIndex: 0,
      created: new Date().toISOString()
    };
    
    const first = data.users[queue[0]];
    
    const text = 
`✅ *СИСТЕМА ЗАПУЩЕНА В "${chat.title}"!*

👥 Участников: ${queue.length}
💰 Стартовый баланс: ${CONFIG.START_BALANCE} баллов
🗳️ Вето: ${CONFIG.VETO_COST} балла

👑 *ПЕРВЫЙ СЕЛЕКТОР:*
${first.name}

🎮 *ОЧЕРЕДЬ:*
${queue.map((id, i) => `${i+1}. ${data.users[id].name}`).join('\n')}

⚡ ${first.name}, выбирай игру:
/select [название игры]`;
    
    bot.sendMessage(chat.id, text, { parse_mode: 'Markdown' });
    await saveData();
  });
  
  // /select [игра] - выбор игры
  bot.onText(/\/select (.+)/, async (msg, match) => {
    const chat = msg.chat;
    const user = msg.from;
    const gameName = match[1];
    
    // Проверяем группу
    const group = data.groups[chat.id];
    if (!group) {
      bot.sendMessage(chat.id, '❌ Система не запущена! Используй /start_system');
      return;
    }
    
    // Проверяем очередь
    const currentId = group.queue[group.currentIndex];
    if (user.id !== currentId) {
      const currentName = data.users[currentId]?.name || 'Игрок';
      bot.sendMessage(chat.id, `❌ Сейчас очередь ${currentName}!`);
      return;
    }
    
    // Проверяем активную игру
    if (data.games[chat.id]) {
      bot.sendMessage(chat.id, '❌ Уже есть активная игра!');
      return;
    }
    
    // Создаём игру
    const game = {
      id: Date.now(),
      name: gameName,
      selectorId: user.id,
      selectorName: user.first_name,
      chatId: chat.id,
      start: Date.now(),
      end: Date.now() + (CONFIG.VOTE_HOURS * 60 * 60 * 1000),
      participants: [user.id],
      vetoes: [],
      status: 'active'
    };
    
    data.games[chat.id] = game;
    
    // Создаём кнопки
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Играю', callback_data: `join_${game.id}` },
          { text: '🗳️ Вето', callback_data: `veto_${game.id}` }
        ],
        [
          { text: '🎭 Пропустить', callback_data: `skip_${game.id}` }
        ]
      ]
    };
    
    const text = 
`🎮 *НОВАЯ ИГРА!*

👑 ${user.first_name} выбирает:
🎯 *${gameName}*

⏰ Голосование: ${CONFIG.VOTE_HOURS} часов
💰 Баланс селектора: ${data.users[user.id].balance} баллов

👇 *Твоё решение:*`;
    
    bot.sendMessage(chat.id, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    
    // Таймер на автоутверждение
    setTimeout(() => finishGame(chat.id), CONFIG.VOTE_HOURS * 60 * 60 * 1000);
    
    await saveData();
  });
  
  // /veto - вето
  bot.onText(/\/veto/, async (msg) => {
    const chat = msg.chat;
    const user = msg.from;
    const game = data.games[chat.id];
    
    if (!game) {
      bot.sendMessage(chat.id, '❌ Нет активной игры!');
      return;
    }
    
    // Проверяем баланс
    const balance = data.users[user.id].balance;
    if (balance < CONFIG.VETO_COST) {
      bot.sendMessage(chat.id, 
`❌ Мало баллов!
У тебя: ${balance}
Нужно: ${CONFIG.VETO_COST}

💡 Участвуй в играх!`);
      return;
    }
    
    // Проверяем, не селектор ли
    if (user.id === game.selectorId) {
      bot.sendMessage(chat.id, '😂 Нельзя ветировать свою игру!');
      return;
    }
    
    // Списание баллов
    data.users[user.id].balance -= CONFIG.VETO_COST;
    
    // Компенсация селектору
    data.users[game.selectorId].balance += CONFIG.WEEKLY_BONUS;
    
    // Добавляем вето
    game.vetoes.push(user.id);
    game.status = 'vetoed';
    
    const text = 
`❌ *ВЕТО!*

${user.first_name} против игры "${game.name}"
• Списано: ${CONFIG.VETO_COST} балла
• Осталось: ${data.users[user.id].balance}

👑 ${game.selectorName} получает ${CONFIG.WEEKLY_BONUS} балл компенсации

🎮 Игра отменена! Выбирай новую:
/select [игра]`;
    
    bot.sendMessage(chat.id, text, { parse_mode: 'Markdown' });
    
    // Удаляем игру
    delete data.games[chat.id];
    await saveData();
  });
  
  // /balance - баланс
  bot.onText(/\/balance/, async (msg) => {
    const user = msg.from;
    const userData = data.users[user.id];
    
    if (!userData) {
      bot.sendMessage(msg.chat.id, '❌ Напиши сначала /start');
      return;
    }
    
    const canVeto = Math.floor(userData.balance / CONFIG.VETO_COST);
    
    const text = 
`💰 *ТВОЙ БАЛАНС*

👤 ${user.first_name}
💎 ${userData.balance} баллов
🗳️ Можешь ветировать: ${canVeto} раз

${userData.balance < CONFIG.VETO_COST ? 
'⚠️ Мало баллов! Участвуй в играх.' : 
'✅ Можешь использовать вето!'}`;
    
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });
  
  // /top - топ игроков
  bot.onText(/\/top/, async (msg) => {
    const users = Object.values(data.users);
    
    if (users.length === 0) {
      bot.sendMessage(msg.chat.id, '📭 Пока нет игроков!');
      return;
    }
    
    // Сортируем по баллам
    users.sort((a, b) => b.balance - a.balance);
    
    let text = '🏆 *ТОП ИГРОКОВ*\n\n';
    
    users.slice(0, 10).forEach((user, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '▫️';
      text += `${medal} ${user.name}: ${user.balance} баллов\n`;
    });
    
    text += `\n👥 Всего: ${users.length} игроков`;
    
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });
  
  // /rules - правила
  bot.onText(/\/rules/, (msg) => {
    const text = 
`📖 *ПРАВИЛА СИСТЕМЫ*

1. 🎮 *Очередь*
   • Каждый выбирает по очереди
   • После игры → следующий

2. 🗳️ *Вето*
   • Стоит ${CONFIG.VETO_COST} балла
   • Одного вето достаточно
   • Селектор получает +${CONFIG.WEEKLY_BONUS} балл

3. 💰 *Баллы*
   • Старт: ${CONFIG.START_BALANCE}
   • Игра: +${CONFIG.GAME_REWARD}
   • Вето: -${CONFIG.VETO_COST}
   • Понедельник: +${CONFIG.WEEKLY_BONUS}

4. ⏰ *Время*
   • 24 часа на голосование
   • Потом игра утверждается

⚡ *Всё автоматически!*`;
    
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });
  
  // /me - статистика
  bot.onText(/\/me/, async (msg) => {
    const user = msg.from;
    const userData = data.users[user.id];
    
    if (!userData) {
      bot.sendMessage(msg.chat.id, '❌ Напиши /start сначала');
      return;
    }
    
    const text = 
`👤 *ТВОЯ СТАТИСТИКА*

📛 ${userData.name}
💎 ${userData.balance} баллов
🗳️ Может ветировать: ${Math.floor(userData.balance / CONFIG.VETO_COST)} раз

💰 *Совет:* ${userData.balance < 3 ? 'Играй больше!' : 'Можешь использовать вето!'}`;
    
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });
  
  // /help - помощь
  bot.onText(/\/help/, (msg) => {
    const text = 
`🆘 *ПОМОЩЬ*

📋 *Команды:*
/start - Начать
/start_system - Запустить в группе
/select [игра] - Выбрать игру
/veto - Наложить вето
/balance - Баланс
/top - Топ игроков
/rules - Правила
/me - Моя статистика

💡 *Советы:*
• Добавь бота в группу
• Дай права админа
• Напиши /start_system
• Начни выбирать игры!

📞 *Проблемы?* Напиши создателю.`;
    
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });
  
  // Обработка кнопок
  bot.on('callback_query', async (callback) => {
    const user = callback.from;
    const chatId = callback.message.chat.id;
    const data = callback.data;
    
    // Отвечаем на callback
    bot.answerCallbackQuery(callback.id);
    
    const [action, gameId] = data.split('_');
    const game = data.games[chatId];
    
    if (!game || game.id != gameId) {
      bot.sendMessage(chatId, '❌ Игра уже завершена!');
      return;
    }
    
    switch(action) {
      case 'join':
        if (!game.participants.includes(user.id)) {
          game.participants.push(user.id);
          bot.sendMessage(chatId, `✅ ${user.first_name} будет играть!`);
        }
        break;
        
      case 'veto':
        // Аналогично команде /veto
        const balance = data.users[user.id]?.balance || 0;
        if (balance >= CONFIG.VETO_COST && user.id !== game.selectorId) {
          data.users[user.id].balance -= CONFIG.VETO_COST;
          data.users[game.selectorId].balance += CONFIG.WEEKLY_BONUS;
          game.vetoes.push(user.id);
          game.status = 'vetoed';
          
          bot.sendMessage(chatId,
`❌ ${user.first_name} против через кнопку!
Игра "${game.name}" отменена.`);
          
          delete data.games[chatId];
        }
        break;
        
      case 'skip':
        bot.sendMessage(chatId, `🎭 ${user.first_name} пропускает`);
        break;
    }
    
    await saveData();
  });
}

// === ФУНКЦИИ ДЛЯ ДАННЫХ ===
async function registerUser(userId, name, username) {
  if (!data.users[userId]) {
    data.users[userId] = {
      id: userId,
      name: name,
      username: username,
      balance: CONFIG.START_BALANCE,
      joined: new Date().toISOString()
    };
    console.log(`✅ Новый: ${name} (${userId})`);
    return true;
  }
  return false;
}

function finishGame(chatId) {
  const game = data.games[chatId];
  if (!game) return;
  
  // Если нет вето - начисляем баллы
  if (game.vetoes.length === 0) {
    game.participants.forEach(userId => {
      if (data.users[userId]) {
        data.users[userId].balance += CONFIG.GAME_REWARD;
      }
    });
    
    // Передаём очередь
    const group = data.groups[chatId];
    if (group) {
      group.currentIndex = (group.currentIndex + 1) % group.queue.length;
      const nextId = group.queue[group.currentIndex];
      const nextName = data.users[nextId]?.name || 'Игрок';
      
      bot.sendMessage(chatId,
`✅ *ИГРА УТВЕРЖДЕНА!*

🎮 "${game.name}" - играем!
💰 Участники получили по ${CONFIG.GAME_REWARD} баллу

👑 Следующий: ${nextName}
Выбирай игру: /select [название]`,
        { parse_mode: 'Markdown' }
      );
    }
  }
  
  delete data.games[chatId];
  saveData();
}

// === РАБОТА С ФАЙЛАМИ ===
async function loadData() {
  try {
    const content = await fs.readFile(CONFIG.DATA_FILE, 'utf8');
    const loaded = JSON.parse(content);
    
    // Копируем данные
    Object.assign(data, loaded);
    
    console.log(`📊 Загружено: ${Object.keys(data.users).length} игроков`);
  } catch (err) {
    console.log('📭 Файл данных не найден, создаём новый...');
    await saveData();
  }
}

async function saveData() {
  try {
    await fs.writeFile(CONFIG.DATA_FILE, JSON.stringify(data, null, 2));
    console.log('💾 Данные сохранены');
  } catch (err) {
    console.error('❌ Ошибка сохранения:', err);
  }
}

// === ЗАПУСК ===
init().catch(err => {
  console.error('❌ Ошибка запуска:', err);
  process.exit(1);
});

// HTTP сервер для Railway
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Бот "Селектор с Вето" работает!</h1>
    <p>Игроков: ${Object.keys(data.users).length}</p>
    <p>Активных игр: ${Object.keys(data.games).length}</p>
  `);
});

app.listen(PORT, () => {
  console.log(`🌐 HTTP сервер на порту ${PORT}`);
});
