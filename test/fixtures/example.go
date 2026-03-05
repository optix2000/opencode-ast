package main

import (
	"fmt"
	"os"
)

type Config struct {
	Name  string
	Value int
}

func Process(input string) Config {
	if len(input) == 0 {
		return Config{}
	}
	return Config{Name: input, Value: len(input)}
}

func (c *Config) String() string {
	return fmt.Sprintf("%s: %d", c.Name, c.Value)
}
