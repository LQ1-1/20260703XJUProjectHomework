import express from 'express'
import type { GameManager } from '../game/GameManager'

export function createAuthRouter(gameManager: GameManager): express.Router {
  const router = express.Router()

  router.post('/login', (req, res) => {
    const { username } = req.body
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' })
    }

    const { uuid, initialPosition, initialHeadingDegrees } = gameManager.login(username)
    const convoy = gameManager.getConvoy()

    res.json({
      uuid,
      username,
      initialPosition,
      initialHeadingDegrees,
      convoy,
    })
  })

  router.post('/logout', (req, res) => {
    const { uuid } = req.body
    if (!uuid) {
      return res.status(400).json({ error: 'UUID is required' })
    }

    gameManager.logout(uuid)
    res.json({ success: true })
  })

  return router
}