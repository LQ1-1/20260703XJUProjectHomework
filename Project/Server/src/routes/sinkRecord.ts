import express from 'express'
import type { GameManager } from '../game/GameManager'

export function createSinkRecordRouter(gameManager: GameManager): express.Router {
  const router = express.Router()

  router.post('/upload', (req, res) => {
    const { senderUUID, targetUUID } = req.body

    if (!senderUUID || !targetUUID) {
      return res.status(400).json({ error: 'senderUUID and targetUUID are required' })
    }

    gameManager.addHitRecord(senderUUID, targetUUID)
    const convoy = gameManager.getConvoy()

    res.json({ success: true, convoy })
  })

  router.get('/records/ships', (req, res) => {
    const records = gameManager.getHitRecordsShips()

    res.json({
      tf: false,
      records,
    })
  })

  router.get('/records/tonnages', (req, res) => {
    const records = gameManager.getHitRecordsTonnages()

    res.json({
      tf: false,
      records,
    })
  })

  return router
}