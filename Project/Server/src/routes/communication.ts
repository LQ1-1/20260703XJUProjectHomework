import express from 'express'
import type { GameManager } from '../game/GameManager'
import type { Communication } from '../types'

export function createCommunicationRouter(gameManager: GameManager): express.Router {
  const router = express.Router()

  router.post('/send', (req, res) => {
    const { sender, senderUUID, receiver, receiverUUID, content, tf } = req.body as Communication

    if (!sender || !senderUUID || !content) {
      return res.status(400).json({ error: 'sender, senderUUID and content are required' })
    }

    const comm: Communication = {
      sender,
      senderUUID,
      receiver: receiver || '',
      receiverUUID: receiverUUID || '',
      content,
      tf: tf || false,
    }

    gameManager.sendCommunication(comm)
    res.json({ success: true })
  })

  router.get('/receive', (req, res) => {
    const { receiverUUID } = req.query

    if (!receiverUUID || typeof receiverUUID !== 'string') {
      return res.status(400).json({ error: 'receiverUUID is required' })
    }

    const communications = gameManager.getCommunications(receiverUUID)
    res.json({ communications })
  })

  return router
}