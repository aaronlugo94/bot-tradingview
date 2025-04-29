const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

// Variables de entorno
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// 🔥 Helper para firmar correctamente
function sign(queryString) {
  const signature = crypto.createHmac('sha256', BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');
  console.log('Firma generada:', signature);
  return signature;
}

// 👉 Función para enviar mensaje a Telegram
async function sendTelegram(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
    });
    console.log('Respuesta de Telegram:', response.data);
  } catch (error) {
    console.error('❌ Error enviando Telegram:', error.message);
  }
}

// 👉 Obtener IP pública (opcional)
async function getPublicIP() {
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    return response.data.ip;
  } catch (error) {
    console.error('❌ Error obteniendo IP:', error.message);
    return null;
  }
}

// 👉 Consultar posiciones abiertas en Binance
async function getPosition(symbol) {
  try {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = sign(queryString);

    const url = `https://fapi.binance.com/fapi/v2/positionRisk?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    const response = await axios.get(url, { headers });
    const positions = response.data;

    console.log('Posiciones abiertas:', positions);

    return positions.find(pos => pos.symbol === symbol) || null;
  } catch (error) {
    console.error('❌ Error obteniendo posición:', error.response?.data || error.message);
    return null;
  }
}

// 👉 Cambiar apalancamiento
async function setLeverage(symbol, leverage = 3) {
  try {
    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&leverage=${leverage}&timestamp=${timestamp}`;
    const signature = sign(queryString);

    const url = `https://fapi.binance.com/fapi/v1/leverage?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    await axios.post(url, null, { headers });
  } catch (error) {
    console.error('❌ Error cambiando leverage:', error.response?.data || error.message);
  }
}

// 👉 Enviar nueva orden a Binance
async function sendOrder(symbol, side, quantity) {
  try {
    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
    const signature = sign(queryString);

    const url = `https://fapi.binance.com/fapi/v1/order?${queryString}&signature=${signature}`;
    const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

    const response = await axios.post(url, null, { headers });

    console.log("Respuesta de Binance:", response.data);

    return response.data;
  } catch (error) {
    console.error('❌ Error enviando orden:', error.response?.data || error.message);
    throw error;
  }
}

// 👉 Obtener el precio de mercado actual
async function getMarkPrice(symbol) {
  try {
    const url = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`;
    const response = await axios.get(url);
    return parseFloat(response.data.price);
  } catch (error) {
    console.error('❌ Error obteniendo el precio de mercado:', error.message);
    return 0;
  }
}

// 👉 Cerrar posición opuesta si existe
async function closeOpposite(symbol, currentPositionAmt, entryPrice, side) {
  try {
    const markPrice = await getMarkPrice(symbol); // Precio actual del mercado
    const pnl = (markPrice - entryPrice) * currentPositionAmt * (side === 'SELL' ? 1 : -1);

    // Determinar el color del mensaje (rojo para pérdida, verde para ganancia)
    const pnlColor = pnl >= 0 ? '🟢' : '🔴';

    // Enviar mensaje con PnL
    await sendTelegram(`
🔄 Posición anterior cerrada:
- Tipo: ${side} ${symbol}
- Cantidad: ${currentPositionAmt}
- Entrada: $${entryPrice.toFixed(2)}
- Precio de Cierre: $${markPrice.toFixed(2)}
- PnL Aproximado: ${pnlColor} $${pnl.toFixed(2)} USDT
    `);
  } catch (error) {
    console.error('❌ Error cerrando posición:', error.message);
  }
}

// 🚀 Bot principal
app.post('/', async (req, res) => {
  try {
    // Mostrar el cuerpo del mensaje recibido
    console.log("Cuerpo recibido:", req.body);

    const { message } = req.body;

    // Verificar si el mensaje está definido
    if (!message) {
      throw new Error('El mensaje recibido es inválido o está vacío.');
    }

    console.log("Mensaje recibido:", message);

    let side, symbol, price;
    // Verificar si el mensaje contiene BUY o SELL
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

    console.log(`Cantidad ajustada: ${quantity}`);

    // Mostrar IP pública (opcional)
    const publicIP = await getPublicIP();
    if (publicIP) {
      await sendTelegram(`🌐 IP pública del servidor: ${publicIP}`);
    }

    // Consultar posición actual
    const position = await getPosition(symbol);

    if (position && parseFloat(position.positionAmt) !== 0) {
      const posSide = parseFloat(position.positionAmt);
      if ((posSide > 0 && side === 'SELL') || (posSide < 0 && side === 'BUY')) {
        console.log('Cerrando posición existente...');
        await closeOpposite(symbol, posSide, price, side);
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

    res.status(200).send('✅ Señal procesada correctamente.');
  } catch (error) {
    console.error("❌ Error:", error.message);
    await sendTelegram(`❌ Error procesando señal: ${JSON.stringify(error.response?.data || error.message)}`);
    res.status(500).send('❌ Error interno.');
  }
});

app.listen(port, () => {
  console.log(`🚀 Bot escuchando en puerto ${port}`);
});
