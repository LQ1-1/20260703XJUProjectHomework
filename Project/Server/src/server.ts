import express from 'express'
import cors from 'cors'
import { GameManager } from './game/GameManager'
import { createAuthRouter } from './routes/auth'
import { createConvoyRouter } from './routes/convoy'
import { createWolfpackRouter } from './routes/wolfpack'
import { createSinkRecordRouter } from './routes/sinkRecord'
import { createCommunicationRouter } from './routes/communication'

const PORT = 3001

const app = express()
const gameManager = new GameManager()

app.use(cors())
app.use(express.json())

app.use('/api/auth', createAuthRouter(gameManager))
app.use('/api/convoy', createConvoyRouter(gameManager))
app.use('/api/wolfpack', createWolfpackRouter(gameManager))
app.use('/api/sink-record', createSinkRecordRouter(gameManager))
app.use('/api/communication', createCommunicationRouter(gameManager))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', players: gameManager.getWolfpack().length })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`API endpoints available at http://localhost:${PORT}/api`)
})