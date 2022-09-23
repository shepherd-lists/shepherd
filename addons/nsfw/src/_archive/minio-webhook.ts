// /**
//  * just using for testing minio webook output
//  */
// import express from 'express' 

// const port = 85
// const app = express()
// app.use(express.json())
// app.get('/', (req, res)=> {
// 	console.log('/ was requested. length', JSON.stringify(req.body).length)
// 	res.status(200).send('webhook listener operational.')
// })
// app.get('/minio-events', (req, res)=>{
// 	const msg = `
// webhook received stuff
// params. ${JSON.stringify(req.params, null,2)}
// query. ${JSON.stringify(req.query, null,2)}
// route. ${JSON.stringify(req.route, null,2)}
// body. ${JSON.stringify(req.body, null,2)}
// `
// 	console.log(msg)
// 	res.sendStatus(200)
// })

// export const server = app.listen(port, ()=> console.log(`started on http://plugin:${port}`))


