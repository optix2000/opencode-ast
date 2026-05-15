variable "region" {
  type = string
}

locals {
  name = "demo"
}

resource "aws_instance" "web" {
  ami = "ami-123"

  tags = {
    Name = local.name
  }

  lifecycle {
    create_before_destroy = true
  }
}

module "vpc" {
  source = "./vpc"
}
