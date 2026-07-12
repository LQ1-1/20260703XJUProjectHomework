import express from 'express'
import type { GameManager } from '../game/GameManager'

export function createWolfpackRouter(gameManager: GameManager): express.Router {
  const router = express.Router()

  router.get('/infos', (req, res) => {
    const wolfpack = gameManager.getWolfpack()

    res.json({
      tf: false,
      wolfpack,
    })
  })

  router.post('/upload', (req, res) => {
    const { uuid, headingDegrees, speed, location, depth, torpedoCount } = req.body

    if (!uuid) {
      return res.status(400).json({ error: 'UUID is required' })
    }

    gameManager.updateUBoatInfo(uuid, {
      headingDegrees,
      speed,
      location,
      depth,
      torpedoCount,
    })

    res.json({ success: true })
  })

  return router
}