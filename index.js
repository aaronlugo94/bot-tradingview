const axios = require('axios');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
app.use(bodyParser.json());

const BINANCE_API_KEY = 'tu_api_key';
const BINANCE_API_SECRET = 'tu_api_secret';
const TELEGRAM_CHAT_ID = '1557254587'; // Tu chat_id de Telegram
const TELEGRAM_API_KEY = 'tu_api_telegram_key';

let dailyPnL = 0;
let weeklyPnL = 0;
let dailyStartTime = new Date().setHours(0, 0, 0, 0);
let weeklyStartTime = new Date().setDate(new Date().getDate() - new Date().getDay());

// Función para firmar la consulta con la API de Binance
function sign(queryString) {
  const crypto = require('crypto');
  return crypto
    .createHmac('sha256', BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');
}

// Función para enviar mensaje a Telegram
async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_API_KEY}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message
    });
  } catch (error) {
    console.error('❌ Error al enviar mensaje a Telegram:', error.response?.data || error.message);
  }
}

// Obtener PnL actual de la posición en Binance
async function getPnL(symbol) {
  try {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = sign(queryString);

    const url = `https://fapi.binance.com/fapi/v2/positionRisk?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    const response = await axios.get(url, { headers });
    const positions = response.data;

    const position = positions.find(pos => pos.symbol === symbol);
    
    if (position) {
      const pnl = parseFloat(position.unrealizedProfit); // PnL no realizado
      return pnl;
    }
    return 0;
  } catch (error) {
    console.error('❌ Error obteniendo PnL:', error.response?.data || error.message);
    return 0;
  }
}

// Consultar la posición de un símbolo en Binance
async function getPosition(symbol) {
  try {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = sign(queryString);

    const url = `https://fapi.binance.com/fapi/v2/positionRisk?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    const response = await axios.get(url, { headers });
    const positions = response.data;

    const position = positions.find(pos => pos.symbol === symbol);
    
    return position || null;
  } catch (error) {
    console.error('❌ Error obteniendo posición:', error.response?.data || error.message);
    return null;
  }
}

// Función para actualizar PnL diario
async function updateDailyPnL(pnl) {
  const currentDate = new Date();
  if (currentDate - dailyStartTime >= 86400000) {  // Si es un nuevo día
    dailyPnL = 0;
    dailyStartTime = currentDate.setHours(0, 0, 0, 0);
  }
  dailyPnL += pnl;
}

// Función para actualizar PnL semanal
async function updateWeeklyPnL(pnl) {
  const currentDate = new Date();
  if (currentDate - weeklyStartTime >= 604800000) {  // Si es una nueva semana
    weeklyPnL = 0;
    weeklyStartTime = new Date().setDate(currentDate.getDate() - currentDate.getDay());
  }
  weeklyPnL += pnl;
}

// Función para enviar orden a Binance (simulación)
async function sendOrder(symbol, side, quantity) {
  // Aquí iría la lógica para enviar una orden a Binance.
  // Por simplicidad, se simula una respuesta de éxito.
  return { orderId: '12345' };
}

// Configuración del webhook de TradingView
app.post('/', async (req, res) => {
  try {
    // Mostrar el cuerpo del mensaje recibido
    console.log("Cuerpo recibido:", req.body);

    const { message } = req.body;
    console.log("Mensaje recibido:", message);

    let side, symbol, price;
    if (message.includes('BUY')) {
      side = 'BUY';
      [_, symbol, price] = message.match(/🟢 BUY - (.+?) a (\d+(\.\d+)?)/);
    } else if (message.includes('SELL')) {
      side = 'SELL';
      [_, symbol, price] = message.match(/🔴 SELL - (.+?) a (\d+(\.\d+)?)/);
    } else {
      throw new Error('Mensaje no reconocido.');
    }

    // Verificar la extracción del símbolo y precio
    console.log(`Extracción - Símbolo: ${symbol}, Precio: ${price}`);

    symbol = symbol.replace('PERP', ''); // Asegurarse de que no contiene 'PERP'
    price = parseFloat(price);

    // Verificar si el símbolo y precio están correctamente formateados
    console.log(`Símbolo procesado: ${symbol}, Precio procesado: ${price}`);

    // Monto fijo de 200 USDT
    const orderUSDT = 200;
    let quantity = (orderUSDT / price);

    // Verificar la cantidad calculada
    console.log(`Cantidad calculada: ${quantity}`);

    // Ajustar decimales dependiendo del par
    if (symbol.endsWith('USDT')) {
      quantity = quantity.toFixed(3); // 3 decimales para crypto (BTC, ETH)
    } else {
      quantity = quantity.toFixed(0); // enteros para otros activos si fuera necesario
    }

    // Verificar la cantidad ajustada
    console.log(`Cantidad ajustada: ${quantity}`);

    // Consultar PnL actual
    const pnl = await getPnL(symbol);
    let pnlMessage = `📊 PnL actual para ${symbol}: $${pnl.toFixed(2)}`;

    // Cambiar el color del mensaje según el PnL
    const pnlColor = pnl >= 0 ? '🟢' : '🔴';
    pnlMessage = `${pnlColor} ${pnlMessage}`;

    // Enviar mensaje a Telegram sobre el PnL
    await sendTelegram(pnlMessage);

    // Consultar posición actual
    const position = await getPosition(symbol);

    if (position && parseFloat(position.positionAmt) !== 0) {
      const posSide = parseFloat(position.positionAmt);
      if ((posSide > 0 && side === 'SELL') || (posSide < 0 && side === 'BUY')) {
        console.log('Cerrando posición existente...');
        await closeOpposite(symbol, posSide);
      }
    }

    // Asegurar leverage correcto
    await setLeverage(symbol, 3);

    // Crear nueva orden
    const orderResult = await sendOrder(symbol, side, quantity);

    console.log("✅ Nueva orden enviada:", orderResult);

    await sendTelegram(`🚀 Nueva operación ejecutada:

- Tipo: ${side}
- Símbolo: ${symbol}
- Precio Aproximado: $${price}
- Cantidad: ${quantity}
- Order ID: ${orderResult.orderId}`);

    // Actualizar PnL diario y semanal
    await updateDailyPnL(pnl);
    await updateWeeklyPnL(pnl);

    // Enviar resumen de PnL diario y semanal
    await sendTelegram(`📅 PnL diario: $${dailyPnL.toFixed(2)}\n📅 PnL semanal: $${weeklyPnL.toFixed(2)}`);

    res.status(200).send('✅ Señal procesada correctamente.');
  } catch (error) {
    console.error("❌ Error:", error.message);
    await sendTelegram(`❌ Error procesando señal: ${JSON.stringify(error.response?.data || error.message)}`);
    res.status(500).send('❌ Error interno.');
  }
});

// Servidor escuchando en puerto 3000
app.listen(3000, () => {
  console.log('Servidor escuchando en puerto 3000...');
});
