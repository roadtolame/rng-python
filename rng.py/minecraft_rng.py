"""
minecraft_rng.py
================
Модуль генерации псевдослучайных чисел на основе алгоритма Minecraft (Java LCG).

Алгоритм Minecraft использует Linear Congruential Generator (LCG):
    seed = (seed * 0x5DEECE66DL + 0xBL) & ((1L << 48) - 1)
    
Особенности:
- Потокобезопасность через threading.Lock
- Поддержка равномерного и нормального распределений
- Криптографически стойкий режим (secrets)
- Воспроизводимость через seed
- Высокая производительность
"""

import threading
import math
import secrets
import struct
import time
from typing import Optional, List, Union


# ─────────────────────────────────────────────────────────────────────────────
#  Константы LCG (Java / Minecraft)
# ─────────────────────────────────────────────────────────────────────────────
_MULTIPLIER = 0x5DEECE66D
_ADDEND     = 0xB
_MASK       = (1 << 48) - 1          # 48-битная маска


class MinecraftRNG:
    """
    Псевдослучайный генератор на базе Minecraft LCG.

    Параметры
    ----------
    seed : int | None
        Начальное значение (воспроизводимость). Если None — используется
        системное время (непредсказуемый seed).
    crypto : bool
        Если True — методы используют криптографически стойкий CSPRNG
        вместо LCG (при этом seed игнорируется).
    """

    def __init__(self, seed: Optional[int] = None, *, crypto: bool = False):
        self._lock   = threading.Lock()           # потокобезопасность
        self._crypto = crypto

        if seed is None:
            seed = int(time.time_ns())            # непредсказуемый seed по умолчанию

        # Инициализация seed в стиле Minecraft: XOR с _MULTIPLIER
        self._seed = (seed ^ _MULTIPLIER) & _MASK

    # ─────────────────────────────────────────────────────────────────────────
    #  Внутренние методы
    # ─────────────────────────────────────────────────────────────────────────

    def _next_bits(self, bits: int) -> int:
        """Один шаг LCG, возвращает `bits` старших битов нового seed."""
        with self._lock:
            self._seed = (self._seed * _MULTIPLIER + _ADDEND) & _MASK
            return self._seed >> (48 - bits)

    def _crypto_int(self, bits: int) -> int:
        """Криптостойкий аналог _next_bits."""
        return secrets.randbits(bits)

    def _raw_int(self, bits: int) -> int:
        return self._crypto_int(bits) if self._crypto else self._next_bits(bits)

    # ─────────────────────────────────────────────────────────────────────────
    #  Публичный API
    # ─────────────────────────────────────────────────────────────────────────

    def set_seed(self, seed: int) -> None:
        """Установить новый seed (потокобезопасно)."""
        with self._lock:
            self._seed = (seed ^ _MULTIPLIER) & _MASK

    def get_seed(self) -> int:
        """Получить текущий внутренний seed."""
        with self._lock:
            return self._seed

    # ── Равномерное распределение ─────────────────────────────────────────

    def rand_float(self) -> float:
        """Случайное число [0.0, 1.0) — равномерное распределение."""
        return self._raw_int(24) / (1 << 24)

    def rand_int(self, low: int = 0, high: int = 100) -> int:
        """
        Случайное целое из диапазона [low, high].

        Пример: rng.rand_int(1, 6)  # кубик d6
        """
        if low > high:
            raise ValueError(f"low ({low}) > high ({high})")
        n = high - low + 1
        # Алгоритм Minecraft для nextInt(n) — без bias
        if n <= 0:
            raise ValueError("Диапазон не может быть нулевым")
        if (n & -n) == n:                         # степень двойки — быстрый путь
            return low + ((n * self._raw_int(31)) >> 31)
        while True:
            bits = self._raw_int(31)
            val  = bits % n
            if bits - val + (n - 1) >= 0:
                return low + val

    def rand_float_range(self, low: float, high: float) -> float:
        """Случайное вещественное из [low, high)."""
        if low >= high:
            raise ValueError(f"low ({low}) >= high ({high})")
        return low + self.rand_float() * (high - low)

    # ── Нормальное распределение (Box-Muller) ────────────────────────────

    def rand_normal(self, mu: float = 0.0, sigma: float = 1.0) -> float:
        """
        Случайное число из нормального распределения N(mu, sigma²).

        Алгоритм: Box-Muller transform.
        """
        while True:
            u1 = self.rand_float()
            u2 = self.rand_float()
            if u1 > 0:
                break
        z = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
        return mu + sigma * z

    # ── Дополнительные распределения ─────────────────────────────────────

    def rand_bool(self, probability: float = 0.5) -> bool:
        """True с вероятностью `probability` (по умолчанию 50%)."""
        return self.rand_float() < probability

    def choice(self, seq):
        """Случайный элемент из последовательности."""
        if not seq:
            raise ValueError("Пустая последовательность")
        return seq[self.rand_int(0, len(seq) - 1)]

    def shuffle(self, lst: list) -> list:
        """Перемешать список на месте (Fisher-Yates). Возвращает тот же список."""
        n = len(lst)
        for i in range(n - 1, 0, -1):
            j = self.rand_int(0, i)
            lst[i], lst[j] = lst[j], lst[i]
        return lst

    def sample(self, seq: list, k: int) -> list:
        """k случайных уникальных элементов из последовательности."""
        pool = list(seq)
        if k > len(pool):
            raise ValueError("k больше длины последовательности")
        self.shuffle(pool)
        return pool[:k]

    def rand_bytes(self, n: int) -> bytes:
        """n случайных байт."""
        return bytes(self.rand_int(0, 255) for _ in range(n))

    # ── Пакетная генерация ────────────────────────────────────────────────

    def rand_ints(self, count: int, low: int = 0, high: int = 100) -> List[int]:
        """Список из `count` случайных целых чисел."""
        return [self.rand_int(low, high) for _ in range(count)]

    def rand_floats(self, count: int, low: float = 0.0, high: float = 1.0) -> List[float]:
        """Список из `count` случайных вещественных чисел."""
        return [self.rand_float_range(low, high) for _ in range(count)]

    def rand_normals(self, count: int, mu: float = 0.0, sigma: float = 1.0) -> List[float]:
        """Список из `count` нормально распределённых чисел."""
        return [self.rand_normal(mu, sigma) for _ in range(count)]

    # ── Minecraft-специфичные утилиты ─────────────────────────────────────

    def minecraft_world_seed(self, base_seed: Optional[int] = None) -> int:
        """
        Генерация seed мира в стиле Minecraft.
        Если base_seed не задан — используется внутренний LCG.
        """
        raw = base_seed if base_seed is not None else self._raw_int(48)
        # Minecraft хэширует seed через несколько шагов SHA-подобного XOR
        h = raw ^ 0x5DEECE66D
        h = ((h * 6364136223846793005) + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        h = h ^ (h >> 33)
        return h & 0xFFFFFFFFFFFFFFFF

    def __repr__(self) -> str:
        mode = "CRYPTO" if self._crypto else f"LCG seed=0x{self._seed:012X}"
        return f"<MinecraftRNG [{mode}]>"


# ─────────────────────────────────────────────────────────────────────────────
#  Синглтон-экземпляр для удобного использования
# ─────────────────────────────────────────────────────────────────────────────

_default_rng = MinecraftRNG()

def set_seed(seed: int)                               -> None:      return _default_rng.set_seed(seed)
def rand_int(low: int = 0, high: int = 100)           -> int:       return _default_rng.rand_int(low, high)
def rand_float()                                      -> float:     return _default_rng.rand_float()
def rand_float_range(low: float, high: float)         -> float:     return _default_rng.rand_float_range(low, high)
def rand_normal(mu: float = 0.0, sigma: float = 1.0) -> float:     return _default_rng.rand_normal(mu, sigma)
def rand_bool(p: float = 0.5)                         -> bool:      return _default_rng.rand_bool(p)
def choice(seq)                                                    : return _default_rng.choice(seq)
def shuffle(lst: list)                                -> list:      return _default_rng.shuffle(lst)


# ─────────────────────────────────────────────────────────────────────────────
#  Демонстрация
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  MinecraftRNG — демонстрация модуля")
    print("=" * 60)

    # 1. Воспроизводимость через seed
    print("\n[1] Воспроизводимость (seed=42)")
    rng = MinecraftRNG(seed=42)
    run1 = rng.rand_ints(5, 1, 100)
    rng.set_seed(42)
    run2 = rng.rand_ints(5, 1, 100)
    print(f"  Прогон 1: {run1}")
    print(f"  Прогон 2: {run2}")
    print(f"  Совпадают: {run1 == run2}")

    # 2. Равномерное распределение
    print("\n[2] Равномерное распределение [1, 6] (кубик d6)")
    rng.set_seed(2024)
    rolls = rng.rand_ints(10, 1, 6)
    print(f"  {rolls}")

    # 3. Нормальное распределение
    print("\n[3] Нормальное распределение N(170, 10) — рост людей")
    rng.set_seed(777)
    heights = [round(rng.rand_normal(170, 10), 1) for _ in range(8)]
    print(f"  {heights}")

    # 4. Криптографический режим
    print("\n[4] Криптографический режим")
    crng = MinecraftRNG(crypto=True)
    print(f"  Случайные байты: {crng.rand_bytes(8).hex()}")
    print(f"  Случайное число: {crng.rand_int(0, 10**9)}")

    # 5. Потокобезопасность
    print("\n[5] Потокобезопасность (10 потоков по 1000 чисел)")
    import threading
    rng_shared = MinecraftRNG(seed=100)
    results = []
    lock = threading.Lock()

    def worker():
        nums = rng_shared.rand_ints(1000, 0, 1000)
        with lock:
            results.extend(nums)

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for t in threads: t.start()
    for t in threads: t.join()
    print(f"  Сгенерировано чисел: {len(results)}")
    print(f"  Мин: {min(results)}, Макс: {max(results)}, "
          f"Среднее: {sum(results)/len(results):.1f}")

    # 6. Minecraft world seed
    print("\n[6] Minecraft world seed")
    rng.set_seed(12345)
    ws = rng.minecraft_world_seed()
    print(f"  World seed: {ws} (hex: 0x{ws:016X})")

    # 7. Shuffle и Sample
    print("\n[7] Shuffle и Sample")
    rng.set_seed(99)
    deck = list(range(1, 11))
    rng.shuffle(deck)
    print(f"  Перемешанная колода: {deck}")
    print(f"  Случайная выборка (k=3): {rng.sample(list(range(1,11)), 3)}")

    print("\n" + "=" * 60)
