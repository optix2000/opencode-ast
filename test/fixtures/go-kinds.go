package main

type BlockChain struct{}

func (bc *BlockChain) InsertReceiptChain() {
	_ = struct{ N int }{N: 1}
}

func SetCanonical() {
	var _ interface{ Log() }
}
