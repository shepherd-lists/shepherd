import * as tf from '@tensorflow/tfjs-node'
import * as nsfw from 'nsfwjs'
import { logger } from '../utils/logger'
import { FilterErrorResult, FilterResult } from '../shepherd-plugin-interfaces/FilterPluginInterface'


const prefix = 'nsfwjs-plugin'

// do this for all envs
tf.enableProdMode()

export class NsfwTools {
	private static _return: FilterResult

	private static _model: nsfw.NSFWJS
	private constructor(){} //hide

	static async init(){
		await NsfwTools.loadModel()
	}

	static async loadModel()   {
		if(NsfwTools._model){
			// model already loaded
			return NsfwTools._model
		}

		logger(prefix, 'loading model once')

		NsfwTools._model = await nsfw.load('file://src/NsfwjsPlugin/model/', {size: 299})
		return NsfwTools._model
	}

	static checkSingleImage = async(pic: Buffer)=> {

		const model = await NsfwTools.loadModel()
	
		const image = tf.node.decodeImage(pic,3) as tf.Tensor3D
		
		const predictions = await model.classify(image)
		image.dispose() // explicit TensorFlow memory management
	
		return predictions
	}

	static checkGif = async(gif: Buffer, txid: string): Promise<FilterResult | FilterErrorResult>=> {

		const result: FilterResult = {
			flagged: false,
			valid_data: true,
		}

		try{

			const model = await NsfwTools.loadModel()
			const framePredictions = await model.classifyGif(gif, {
				topk: 1,
				fps: 1,
			})

			// let flagged = false
			let score: {nsfw_hentai?: number, nsfw_porn?: number, nsfw_sexy?: number } = {}

			for(const frame of framePredictions) {
				const class1 = frame[0].className
				const prob1 = frame[0].probability

				if(class1 === 'Hentai'){
					if(prob1 >= 0.5){
						logger(prefix, 'hentai gif detected', txid)
						result.flagged = true
						score.nsfw_hentai = prob1
						break;
					}
					logger(prefix, 'hentai < 0.5', txid)
				}
				
				if(class1 === 'Porn'){
					logger(prefix, 'porn gif detected', txid)
					result.flagged = true
					score.nsfw_porn = prob1
					break;
				}
				
				if(class1 === 'Sexy'){
					logger(prefix, 'sexy gif detected', txid)
					result.flagged = true
					score.nsfw_sexy = prob1
					break;
				}
			}

			if(process.env.NODE_ENV === 'test' && !result.flagged){ 
				logger(prefix, 'gif clean', txid)
			}

			result.scores = JSON.stringify(score)
			return result;

		}catch(e){

			/* handle all the bad data */

			if(
				e.message === 'Invalid GIF 87a/89a header.'
				|| e.message.startsWith('Unknown gif block:')
				|| e.message.startsWith('Invalid typed array length:')
				|| e.message === 'Invalid block size'
				|| e.message === 'Frame index out of range.'
			){
				// still not gauranteed to be corrupt, browser may be able to open these
				logger(prefix, `gif. probable corrupt data found (${e.message})`, txid) 
				return{
					flagged: undefined,
					data_reason: 'corrupt-maybe',
					err_message: e.message,
				}
			}

			else{
				logger(prefix, 'UNHANDLED error processing gif', txid + ' ', e.name, ':', e.message)
				throw e
			}
		}
	}

	static checkImage = async(pic: Buffer, contentType: string, txid: string): Promise<FilterResult | FilterErrorResult> => {

		// Currently we only support these types:
		if( !["image/bmp", "image/jpeg", "image/png", "image/gif"].includes(contentType) ){
			return {
				flagged: undefined,
				data_reason: 'unsupported',
			}
		}

		// Separate handling for GIFs
		if(contentType === 'image/gif') return NsfwTools.checkGif(pic, txid)

		try {
			
			const predictions = await NsfwTools.checkSingleImage(pic)
			
			/* our first attempt prediction formula: flagged = (porn + sexy + hentai) > 0.5 */

			//make prediction data easier to work with 
			type Scores = Record<'Drawing' | 'Hentai' | 'Neutral' | 'Porn' | 'Sexy', number> 
			let scores: Scores = {'Drawing': 0,	'Hentai': 0, 'Neutral': 0, 'Porn': 0, 'Sexy': 0}
			for (const prediction of predictions) {
				scores[prediction.className] = prediction.probability
			}

			let sum = scores['Porn'] + scores['Sexy'] + scores['Hentai']
			const flagged = (sum > 0.5)
	
			if(flagged){
				logger(prefix, txid, flagged, JSON.stringify(scores))
			}
			
			return {
				flagged,
				valid_data: true,
				scores: JSON.stringify(scores),
			}

		} catch (e) {

			/* catch all sorts of bad data */

			if(
				e.message === 'Expected image (BMP, JPEG, PNG, or GIF), but got unsupported image type'
				&& (['image/bmp', 'image/jpeg', 'image/png'].includes(contentType)) //sanity, should already be checked
			){
				logger(prefix, 'probable corrupt data found', contentType, txid)
				return {
					flagged: undefined, //undefined as not 100% sure, might be tfjs problem opening file
					data_reason: 'corrupt-maybe',
				}
			}
			
			else if(e.message.startsWith('Invalid TF_Status: 3')){

				/* Handle these errors depending on error reason given. */
				const reason: string = e.message.split('\n')[1]
				
				if(
					reason.startsWith('Message: Invalid PNG data, size')
					|| reason === 'Message: jpeg::Uncompress failed. Invalid JPEG data or crop window.'
				){
					//partial image
					logger(prefix, 'partial image found', contentType, txid)
					return {
						flagged: undefined,
						data_reason: 'partial',
					}
				}
				
				else if(reason === 'Message: PNG size too large for int: 23622 by 23622'){
					//oversized png
					// logger(prefix, 'oversized png found', contentType, txid)
					return {
						flagged: undefined,
						data_reason: 'oversized',
					}
				}
				
				else if(
					reason === 'Message: Input size should match (header_size + row_size * abs_height) but they differ by 2'
					|| reason.startsWith('Message: Number of channels inherent in the image must be 1, 3 or 4, was')
				){
					// unreadable data
					// logger(prefix, 'bad data found', contentType, url)
					// await dbCorruptDataConfirmed(txid)
					return{
						flagged: undefined, //error signal, this will be flagged false
						data_reason: 'corrupt',
					}
				}

				else if(reason === 'Message: Invalid PNG. Failed to initialize decoder.'){
					// unknown issue - too big maybe? these images are opening in the browser.
					logger(prefix, 'treating as partial.', e.message, contentType, txid)
					return{
						flagged: undefined,
						data_reason: 'partial',
					}
				}
				
				else{
					logger(prefix, 'UNHANDLED "Invalid TF_Status: 3" found. Reason:', reason, contentType, txid)
					throw e
				}
			}
			
			else{
				logger(prefix, `UNHANDLED error processing [${txid}]`, e.name, ':', e.message)
				throw e
			}
		}
	}
}
