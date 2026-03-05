import os
from pathlib import Path


class Parser:
    def __init__(self, data: str):
        self.data = data

    def parse(self) -> bool:
        return len(self.data) > 0


def process(input: str) -> str:
    if not input:
        return ""
    return input.upper()


@decorator
def decorated():
    pass
