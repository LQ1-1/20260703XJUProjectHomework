import express from 'express'
import type { GameManager } from '../game/GameManager'

export function createConvoyRouter(gameManager: GameManager): express.Router {
  const router = express.Router()

  router.get('/info', (req, res) => {
    const convoy = gameManager.getConvoy()

    res.json({
      tf: false,
      convoy,
    })
  })

  return router
}