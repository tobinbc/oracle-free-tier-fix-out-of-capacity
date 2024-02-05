const crypto = require("crypto");
const sshpk = require("sshpk");

module.exports.handler = async () => {
    const { ssh_authorized_key, privateKey } = await new Promise((res, rej) => {
        crypto.generateKeyPair(
          "rsa",
          {
            modulusLength: 4096,
            publicKeyEncoding: {
              type: "pkcs1",
              format: "pem",
            },
            privateKeyEncoding: {
              type: "pkcs8",
              format: "pem",
            },
          },
          (err, publicKey, privateKey) => {
            if (err) {
              rej(err);
            } else {
                const pemKey = sshpk.parseKey(publicKey, 'pem',{
                    filename: 'free_tier_instance',
                });
                const sshRsa = pemKey.toString('ssh');
              res({ ssh_authorized_key: sshRsa, privateKey });
            }
          }
        );
      });
      console.log(ssh_authorized_key);
      console.log(privateKey);
}