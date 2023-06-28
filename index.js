const express = require("express");
const bodyParser = require("body-parser");
const { Sequelize, Model, DataTypes, Op } = require("sequelize");
const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});
const port = 3005;
const cors = require("cors");
app.use(cors());
app.use(bodyParser.json());

const connectedUsers = new Map();


const sequelize = new Sequelize("messenger", "root", "", {
    dialect: "mysql",
    host: "localhost",
});


const User = sequelize.define("user", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: true
    },
    surname: {
        type: DataTypes.STRING,
        allowNull: true
    },
    username: {
        type: DataTypes.STRING,
        allowNull: true
    },
    profileImage: {
        type: DataTypes.STRING,
        allowNull: true
    },
    online: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    last_seen: {
        type: DataTypes.DATE,
        allowNull: true
    }
})

const Message = sequelize.define("message", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    sender_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: "id",
        },
    },
    receiver_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: "id",
        },
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
});

const Friends = sequelize.define("friends", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    friend_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: "id",
        },
    }
})


User.hasMany(Message, { foreignKey: "sender_id", as: "sentMessages" });
User.hasMany(Message, { foreignKey: "receiver_id", as: "receivedMessages" });
Message.belongsTo(User, { foreignKey: "sender_id", as: "sender" });
Message.belongsTo(User, { foreignKey: "receiver_id", as: "receiver" });
Friends.belongsTo(User, { foreignKey: "friend_id", as: "friend" })

sequelize.sync().then(() => {
    console.log("Veritabanı senkronize edildi.");
});

app.post("/api/friends", async (req, res) => {

    const { username } = req.body;

    try {
        const user = await User.findOne({ where: { username: username } });
        if (user) {
            const friends = await Friends.findAll({
                where: {
                    user_id: user.id
                },
                include: {
                    model: User,
                    as: 'friend',
                    attributes: ['id', 'name', 'surname', 'username', 'profileImage', 'online', 'last_seen']
                }
            });
            res.json({
                user_id: user.id,
                friends
            });
        } else {
            res.status(500).json({ error: "Kullanıcı adını kontrol ediniz!" });
        }

    } catch (error) {
        res.status(500).json({ error: "Kullanıcı adını kontrol ediniz!" });
    }
});


io.on("connection", (socket) => {
    console.log("[Socket Server]: Socket bağlantısı sağlandı.");

    socket.on("joinRoom", async (roomData) => {
        socket.join(roomData.roomId);
        console.log("[join] ", roomData)
        const roomDetails = roomData.roomId?.split("-");

        const user = await User.findByPk(roomData.userId);
        if (user) {
            user.online = true;
            await user.save();
        }

        const activeUsers = await User.findAll({
            where: {
                [Op.or]: [
                    {
                        id: Number(roomDetails[0]),
                        online: true
                    },
                    {
                        id: Number(roomDetails[1]),
                        online: true
                    }
                ]
            },
        });

        const userConnectionData = {
            userId: roomData.userId,
            socketId: socket.id,
            roomId: roomData.roomId,
        };
        connectedUsers.set(socket.id, userConnectionData);

        io.emit("userOnline", activeUsers);


        try {
            if (roomDetails?.length == 2) {
                const messages = await Message.findAll({
                    where: {
                        [Op.or]: [
                            {
                                sender_id: Number(roomDetails[0]),
                                receiver_id: Number(roomDetails[1])
                            },
                            {
                                sender_id: Number(roomDetails[1]),
                                receiver_id: Number(roomDetails[0])
                            }
                        ]
                    },
                    include: [
                        { model: User, as: "sender", attributes: ["profileImage"] },
                        { model: User, as: "receiver", attributes: ["profileImage"] }
                    ]
                });
                socket.emit("previousMessages", messages);
            }

        } catch (error) {
            console.error("Önceki mesajları çekerken bir hata oluştu:", error);
        }
    });


    socket.on("sendMessage", async (data) => {
        console.log("[sendMessage]: eventi tetiklendi", data);

        try {
            const message = await Message.create({
                message: data.message,
                sender_id: Number(data.senderId),
                receiver_id: Number(data.receiverId),
            });

            const detailedMessage = await Message.findOne({
                where: { id: message.id },
                include: [{ model: User, as: "sender", attributes: ["profileImage"] }, { model: User, as: "receiver", attributes: ["profileImage"] }]
            });
            io.to(data.roomId).emit("receiveMessage", detailedMessage);
        } catch (error) {
            console.error("Mesaj kaydedilirken bir hata oluştu:", error);
        }
    });

    socket.on("disconnect", async () => {
        console.log("[Socket Server]: Socket bağlantısı sonlandı.")
        const roomData = connectedUsers.get(socket.id);
        if (roomData) {
            connectedUsers.delete(socket.id);

            const user = await User.findOne({ where: { id: roomData.userId } });
            if (user) {
                user.online = false;
                user.last_seen = new Date();
                await user.save();
            }

            io.to(roomData.roomId).emit("userOffline", roomData.userId)

        }
    })
})


server.listen(port, () => {
    console.log(`[Socket Server] : ${port} port'unda çalışmaya başladı.`)
    sequelize.sync().then(() => {
        console.log("Veritabanı senkronize edildi.");
    });
})