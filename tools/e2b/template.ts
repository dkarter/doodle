import { Template, waitForPort } from "e2b";

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
    "openssh-server",
  ])
  .runCmd("curl -fsSL https://mise.run/bash | sh")
  .runCmd("curl -fsSL https://get.docker.com | sh")
  .runCmd([
    "curl -fsSL -o /usr/local/bin/websocat https://github.com/vi/websocat/releases/latest/download/websocat.x86_64-unknown-linux-musl",
    "chmod a+x /usr/local/bin/websocat",
  ], { user: "root" })
  .runCmd("/home/user/.local/bin/mise --version")
  .runCmd("docker --version")
  .setStartCmd(
    "sudo bash -lc 'mkdir -p /run/sshd && service ssh start >/dev/null 2>&1 || /usr/sbin/sshd; /usr/local/bin/websocat -b --exit-on-eof ws-l:0.0.0.0:8081 tcp:127.0.0.1:22'",
    waitForPort(8081),
  );
