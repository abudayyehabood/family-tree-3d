import { MAX_GENERATION, MAX_WIVES } from '../model'
import type { Gender, TreeNode } from '../model'
import { FEMALE_NAMES, MALE_NAMES } from './names'
import { createRng } from './random'
import { createFounder, newId } from './tree'

function member(name: string, gender: Gender, generation: number, children: TreeNode[] = []): TreeNode {
  return { id: newId(), type: 'member', name, gender, generation, children }
}

function wife(name: string, generation: number, children: TreeNode[] = []): TreeNode {
  return { id: newId(), type: 'wife', name, gender: 'female', generation, children }
}

export function createEmptyTree(): TreeNode {
  return createFounder()
}

/** A hand-written 3-generation family: founder → 2 wives → 5 children → 6 grandchildren. */
export function createDemoFamily(): TreeNode {
  return member('عبد الله', 'male', 1, [
    wife('فاطمة', 1, [
      member('محمد', 'male', 2, [wife('سارة', 2, [member('يوسف', 'male', 3), member('نور', 'female', 3)])]),
      member('أحمد', 'male', 2, [wife('ليلى', 2, [member('خالد', 'male', 3), member('هدى', 'female', 3)])]),
      member('مريم', 'female', 2),
    ]),
    wife('خديجة', 1, [
      member('علي', 'male', 2, [wife('رقية', 2, [member('حسن', 'male', 3), member('سلمى', 'female', 3)])]),
      member('زينب', 'female', 2),
    ]),
  ])
}

/**
 * Target number of members born into each generation (index 0 = generation 1).
 * Together with the wives this lands close to 1,500 people across 15 generations.
 */
const MEMBERS_PER_GENERATION = [1, 4, 8, 14, 24, 38, 56, 78, 96, 110, 120, 128, 132, 134, 136]

function pickWifeCount(roll: number): number {
  if (roll < 0.45) return 1
  if (roll < 0.78) return 2
  if (roll < 0.93) return 3
  return 4
}

/** Realistic stress-test tree: 15 generations, multiple wives, ~1,500 people. */
export function createStressTree(seed = 20260926): TreeNode {
  const rng = createRng(seed)
  const founder = member(rng.pick(MALE_NAMES), 'male', 1)
  let fathers: TreeNode[] = [founder]

  for (let gen = 1; gen < MAX_GENERATION; gen++) {
    const target = MEMBERS_PER_GENERATION[gen]
    const born: TreeNode[] = []
    const mothers: TreeNode[] = []
    const candidates = rng.shuffle([...fathers])

    for (const father of candidates) {
      if (born.length >= target) break
      const wifeCount = pickWifeCount(rng.next())
      for (let w = 0; w < wifeCount && born.length < target; w++) {
        const mother = wife(rng.pick(FEMALE_NAMES), gen)
        father.children.push(mother)
        mothers.push(mother)
        const kids = Math.min(rng.int(1, 4), target - born.length)
        for (let k = 0; k < kids; k++) {
          const gender: Gender = rng.chance(0.55) ? 'male' : 'female'
          const child = member(rng.pick(gender === 'male' ? MALE_NAMES : FEMALE_NAMES), gender, gen + 1)
          mother.children.push(child)
          born.push(child)
        }
      }
    }

    // Not enough fathers to reach the target: give extra children to existing mothers,
    // or marry additional wives where the husband still has room.
    let guard = 0
    while (born.length < target && guard++ < 10_000) {
      const father = rng.pick(candidates)
      let mother: TreeNode
      if (father.children.length < MAX_WIVES && (father.children.length === 0 || rng.chance(0.3))) {
        mother = wife(rng.pick(FEMALE_NAMES), gen)
        father.children.push(mother)
        mothers.push(mother)
      } else if (father.children.length) {
        mother = rng.pick(father.children)
      } else {
        continue
      }
      const gender: Gender = rng.chance(0.55) ? 'male' : 'female'
      const child = member(rng.pick(gender === 'male' ? MALE_NAMES : FEMALE_NAMES), gender, gen + 1)
      mother.children.push(child)
      born.push(child)
    }

    fathers = born.filter((m) => m.gender === 'male')
    if (fathers.length === 0 && born.length) {
      const first = born[0]
      first.gender = 'male'
      first.name = rng.pick(MALE_NAMES)
      fathers = [first]
    }
  }

  return founder
}
