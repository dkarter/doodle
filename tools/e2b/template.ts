import { Template } from "e2b";

export const template = Template()
  .fromBaseImage()
  .aptInstall([
    "ca-certificates",
    "curl",
    "git",
    "build-essential",
    "autoconf",
    "m4",
    "libncurses-dev",
    "libssl-dev",
    "libssh-dev",
    "unixodbc-dev",
    "xsltproc",
    "fop",
    "libxml2-utils",
    "openjdk-17-jdk-headless",
    "nodejs",
    "npm",
    "unzip",
    "neovim",
  ])
  .runCmd("curl -fsSL https://mise.run | sh")
  .runCmd("curl -fsSL https://get.docker.com | sh")
  .runCmd("/home/user/.local/bin/mise --version")
  .runCmd("docker --version");
