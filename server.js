const express = require('express');
const cors = require('cors');
const {ClarifaiStub, grpc} = require("clarifai-nodejs-grpc");
const bcrypt = require('bcrypt');
const knex = require('knex')({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  }
});

const app = express();
const port = 3001;
const saltRounds = 10;

const stub = ClarifaiStub.grpc();

const metadata = new grpc.Metadata();
metadata.set("authorization", `Key ${process.env.API_KEY}`);

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('app is working')
})

app.post('/register', (req, res) => {
  const { name,email, password } = req.body;
  const hash = bcrypt.hashSync(password, saltRounds);
  knex.transaction(trx => {
    return trx
      .insert({
        email: email,
        password: hash
      })
      .into('login')
      .returning('email')
      .then(loginEmail => {
        trx('users')
          .insert({
            name: name,
            email: loginEmail[0].email,
            joined: new Date()
          })
          .returning('*')
          .then(user => {
            const localTimeJoined = new Date(user[0].joined);
            localTimeJoined.setMinutes( localTimeJoined.getMinutes() - localTimeJoined.getTimezoneOffset() );
            user[0].joined = localTimeJoined;
            res.json(user[0]);
          })
          .catch(error => {
            console.log(error);
            res.status(400).json('Missing / incorrect credentials. Please try again.');
          });
      })
      .then(trx.commit)
      .catch(trx.rollback)
  })
  .catch(error => {
    console.log(error);
    res.status(400).json('Unable to register. Credentials already exist.');
  });
})

app.post('/signin', (req, res) => {
  const { email, password } = req.body;
  if (req.body.email && req.body.password) {
    knex('login')
      .where({
        email: req.body.email
      })
      .select('password')
      .then(password => {
        const isPasswordCorrect = bcrypt.compareSync(req.body.password, password[0].password);
        if (isPasswordCorrect) {
          knex('users')
          .where({
            email: email
          })
          .select()
          .then(user => {
            const localTimeJoined = new Date(user[0].joined);
            localTimeJoined.setMinutes( localTimeJoined.getMinutes() - localTimeJoined.getTimezoneOffset() );
            user[0].joined = localTimeJoined;
            res.json(user[0]);
          })
          .catch(err => console.log(err))
        } else {
          res.status(400).json('Incorrect credentials. Please try again.');
        }
      })
  } else {
    res.status(400).json('Missing credentials. Please try again.');
  }
})

app.post('/apiCall', (req, res) => {
  stub.PostModelOutputs(
    {
        model_id: "face-detection",
        version_id: "6dc7e46bc9124c5c8824be4822abe105",
        inputs: [{data: {image: {url: req.body.input}}}]
    },
    metadata,
    (err, response) => {
        if (err) {
            console.log("Error: " + err);
            return;
        }
        if (response.status.code !== 10000) {
            console.log(`Received failed status: ${response.status.description}\n${response.status.details}`);
            return;
        }
        const regions = response.outputs[0].data.regions.map(region => ({'id': region.id, 'bounding_box': region.region_info.bounding_box}));
        res.send(regions);
    }
  );
})

app.put('/imageEntry', (req, res) => {
  const { id } = req.body;
  knex('users')
    .where('id', id)
    .increment('entries', 1)
    .returning('entries')
    .then(entries => res.json(entries[0].entries))
    .catch(err => res.status(400).json('Unable to update entries.'))
})

app.listen(process.env.PORT || port, () => {
  console.log(`App listening on port ${process.env.PORT}`);
})