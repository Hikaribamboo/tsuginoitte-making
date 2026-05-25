from __future__ import annotations


def problem_rating(diff: int) -> int | None:
    if diff <= 70:
        return None
    if diff >= 700:
        return 1000
    if diff > 600:
        return 1300
    if diff > 500:
        return 1400
    if diff > 390:
        return 1500
    if diff > 270:
        return 1600
    if diff > 190:
        return 1700
    if diff > 130:
        return 1800
    if diff > 90:
        return 1900
    return 2000
