import * as THREE from 'three'

export type GameEntityType = 'submarine' | 'cargoShip' | 'torpedo'

export interface GameEntity{
    id: string
    type: GameEntityType
    root: THREE.Object3D
}

export class GameEntityRegistry{
    private readonly entities = new Map<string, GameEntity>()

    //这个函数最好在模型Controller里面执行, 在Controller的create()函数里面执行
    register(entity: GameEntity): void{
        this.entities.set(entity.id, entity)
    }

    unregister(id: string): void{
        this.entities.delete(id)
    }

    getById(id: string): GameEntity | undefined{
        return this.entities.get(id)
    }

    getAll(): GameEntity[]{
        return Array.from(this.entities.values())
    }

    getByType(type: GameEntityType): GameEntity[]{
        return this.getAll().filter((entity)=>entity.type === type)
    }

    clear(): void{
        this.entities.clear()
    }
}



