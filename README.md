# IMPOSTOR

Jogo social multiplayer em tempo real para rodar localmente em uma rede Wi-Fi/LAN.

## Como rodar no Windows

1. Instale o Node.js LTS, se ainda nao tiver.
2. Abra o PowerShell nesta pasta.
3. Instale as dependencias:

```powershell
npm install
```

4. Inicie o servidor:

```powershell
npm start
```

5. No computador, abra:

```text
http://localhost:3000
```

## Como acessar pelo celular na mesma rede

1. No PowerShell, rode:

```powershell
ipconfig
```

2. Procure o adaptador de Wi-Fi e copie o `Endereço IPv4`.
3. No celular conectado ao mesmo Wi-Fi, abra:

```text
http://SEU-IP:3000
```

Exemplo:

```text
http://192.168.1.10:3000
```

Se o Windows Firewall perguntar, permita o acesso na rede privada.
