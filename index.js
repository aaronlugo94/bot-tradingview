const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sign(queryString) {
    const signature = crypto.createHmac('sha256', BINANCE_API_SECRET)
        .update(queryString)
        .digest('hex');
    return signature;
}

async function sendTelegram(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
        });
    } catch (error) {
        console.error('❌ Error enviando Telegram:', error.message);
    }
}

async function getPublicIP() {
    try {
        const response = await axios.get('https://api.ipify.org?format=json');
        return response.data.ip;
    } catch (error) {
        console.error('❌ Error obteniendo IP:', error.message);
        return null;
    }
}

async function getPosition(symbol) {
    try {
        const timestamp = Date.now();
        const queryString = `timestamp=${timestamp}`;
        const signature = sign(queryString);

        const url = `https://fapi.binance.com/fapi/v2/positionRisk?${queryString}&signature=${signature}`;
        const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

        const response = await axios.get(url, { headers });
        const positions = response.data;
        
        return positions.find(pos => pos.symbol === symbol && parseFloat(pos.positionAmt) !== 0) || null;
    } catch (error) {
        console.error('❌ Error obteniendo posición:', error.response?.data || error.message);
        return null;
    }
}

async function setLeverage(symbol, leverage) {
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

async function getMarkPrice(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
        const response = await axios.get(url);
        return parseFloat(response.data.markPrice);
    } catch (error) {
        console.error('❌ Error obteniendo el precio de mercado:', error.response?.data || error.message);
        return null;
    }
}

async function getSymbolInfo(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/exchangeInfo`;
        const response = await axios.get(url);
        const symbolInfo = response.data.symbols.find(s => s.symbol === symbol);
        return symbolInfo;
    } catch (error) {
        console.error('❌ Error obteniendo información del símbolo:', error.response?.data || error.message);
        return null;
    }
}

async function sendOrder(symbol, side, quantity) {
    try {
        const symbolInfo = await getSymbolInfo(symbol);
        const precision = symbolInfo?.quantityPrecision || 0;
        const adjustedQuantity = parseFloat(quantity).toFixed(precision);

        const timestamp = Date.now();
        const queryString = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${adjustedQuantity}&timestamp=${timestamp}`;
        const signature = sign(queryString);

        const url = `https://fapi.binance.com/fapi/v1/order?${queryString}&signature=${signature}`;
        const headers = { 'X-MBX-APIKEY': BINANCE_API_KEY };

        const response = await axios.post(url, null, { headers });
        return response.data;
    } catch (error) {
        console.error('❌ Error enviando orden:', error.response?.data || error.message);
        throw error;
    }
}

// =============================================================================
// === FUNCIÓN DE CIERRE MODIFICADA ============================================
// =============================================================================
async function closeOpposite(symbol, position) {
    try {
        const oppositeSide = parseFloat(position.positionAmt) > 0 ? 'SELL' : 'BUY';
        const quantityToClose = Math.abs(parseFloat(position.positionAmt));
        const entryPrice = parseFloat(position.entryPrice);

        // Obtenemos el precio de cierre para calcular el PnL
        const markPrice = await getMarkPrice(symbol);
        
        // Enviamos la orden de cierre
        await sendOrder(symbol, oppositeSide, quantityToClose);

        if (!markPrice) {
            await sendTelegram(`✅ Posición en ${symbol} cerrada (No se pudo calcular PnL).`);
            return;
        }

        // Calculamos el PnL
        const pnl = (markPrice - entryPrice) * parseFloat(position.positionAmt);
        const pnlMessage = pnl >= 0 
            ? `✅ PnL: +$${pnl.toFixed(2)}` 
            : `❌ PnL: -$${Math.abs(pnl).toFixed(2)}`;

        await sendTelegram(`✅ Posición en ${symbol} cerrada.\n${pnlMessage}`);

    } catch (error) {
        console.error('❌ Error cerrando posición:', error.message);
        await sendTelegram(`❌ Error al intentar cerrar la posición en ${symbol}.`);
    }
}

// 🚀 Bot principal
app.post('/', async (req, res) => {
    try {
        console.log("Cuerpo recibido:", req.body);
        const { message } = req.body;

        if (!message) throw new Error('El mensaje recibido es inválido o está vacío.');

        let side, symbol, price;
        if (message.includes('BUY')) {
            side = 'BUY';
            [, symbol, price] = message.match(/🟢 BUY - (.+?) a (\d+(\.\d+)?)/);
        } else if (message.includes('SELL')) {
            side = 'SELL';
            [, symbol, price] = message.match(/🔴 SELL - (.+?) a (\d+(\.\d+)?)/);
        } else {
            throw new Error('Mensaje no reconocido.');
        }

        symbol = symbol.replace(/PERP|\.p/gi, '').toUpperCase();
        price = parseFloat(price);

        const position = await getPosition(symbol);
        
        // Lógica de Cierre: Si hay un LONG y llega un SELL, solo cierra y termina.
        if (position && parseFloat(position.positionAmt) > 0 && side === 'SELL') {
            console.log('Señal de SELL recibida con LONG abierto. Cerrando posición...');
            await closeOpposite(symbol, position);
            return res.status(200).send('✅ Posición LONG cerrada correctamente.');
        }

        // Lógica para evitar abrir un nuevo trade si ya existe uno
        if (position) {
            console.log('Ya hay una posición abierta. No se hace nada.');
            return res.status(200).send('Ignorado: Ya existe una posición.');
        }

        // <-- INICIO DE LA MODIFICACIÓN
        // Solo procederemos a abrir una nueva posición si la señal es de compra (BUY).
        if (side === 'BUY') {
            const leverage = 3; // Definimos el apalancamiento a usar
            await setLeverage(symbol, leverage);
            
            const markPrice = await getMarkPrice(symbol);
            if (!markPrice || markPrice <= 0) throw new Error('No se pudo obtener el precio de mercado.');
            
            const orderUSDT = 300;
            const quantity = orderUSDT / markPrice;

            const orderResult = await sendOrder(symbol, side, quantity);

            // Mensaje de apertura modificado
            await sendTelegram(`🚀 Nueva operación ejecutada:
- Tipo: ${side}
- Símbolo: ${symbol}
- Apalancamiento: ${leverage}x
- Precio Aproximado: $${markPrice.toFixed(2)}
- Cantidad: ${quantity.toFixed(3)}
- Order ID: ${orderResult.orderId}`);

            res.status(200).send('✅ Señal de apertura procesada correctamente.');
        } else {
            // Si la señal es SELL y no hay posición abierta, la ignoramos.
            console.log('Señal de SELL ignorada, no hay posición abierta para cerrar.');
            res.status(200).send('Ignorado: Señal de SELL sin posición LONG abierta.');
        }
        // <-- FIN DE LA MODIFICACIÓN

    } catch (error) {
        console.error("❌ Error:", error.message);
        await sendTelegram(`❌ Error procesando señal: ${JSON.stringify(error.response?.data || error.message)}`);
        res.status(500).send('❌ Error interno.');
    }
});

app.listen(port, async () => {
    const ip = await getPublicIP();
    console.log(`🚀 Bot escuchando en puerto ${port}`);
    if (ip) {
        console.log(`IP Pública: ${ip} (Útil para whitelists en Binance)`);
    }
});
