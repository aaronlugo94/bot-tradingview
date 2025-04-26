const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 8080;

// Ruta para obtener la IP pública de Railway
app.get('/get-ip', async (req, res) => {
  try {
    // Hacemos una solicitud HTTP a ipify para obtener la IP pública
    const response = await axios.get('https://api.ipify.org?format=json');
    // Enviamos la IP pública como respuesta
    res.status(200).json({ ip: response.data.ip });
  } catch (error) {
    // Si ocurre algún error, lo capturamos y respondemos con un error 500
    res.status(500).send('Error al obtener la IP');
  }
});

// Inicia el servidor
app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${port}`);
});
