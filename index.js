const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();  // Inicializa la app de Express
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

// Definir las rutas y la lógica del bot aquí...

app.post('/', async (req, res) => {
  const { message } = req.body;
  console.log("📨 Mensaje recibido:", message);

  if (!message) {
    return res.status(400).send('Mensaje no recibido');
  }

  await sendTelegramMessage(message);

  const match = message.match(/(BUY|SELL).*?([A-Z]+USDT).*?a\s([\d.]+)/i);
  if (!match) {
    console.log("❌ No se pudo extraer símbolo o precio del mensaje.");
    return res.status(200).send("Mensaje recibido sin datos válidos.");
  }

  const [, side, symbol, priceStr] = match;
  const quantityUSD = 1000;
  const price = parseFloat(priceStr);
  const quantity = (quantityUSD / price).toFixed(3);

  await sendBybitOrder(symbol, side.toUpperCase(), quantity);
  res.send("Mensaje procesado");
});

// Healthcheck
app.get('/', (req, res) => {
  res.send("👋 El bot está activo");
});

app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${port}`);
});
